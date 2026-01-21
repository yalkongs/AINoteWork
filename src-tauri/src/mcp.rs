use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: Option<u64>,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcError {
    #[allow(dead_code)]
    code: i64,
    message: String,
}

pub struct McpClient {
    process: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    stdout: Arc<Mutex<Option<BufReader<tokio::process::ChildStdout>>>>,
    request_id: AtomicU64,
    notion_token: Arc<tokio::sync::RwLock<Option<String>>>,
    database_id: Arc<tokio::sync::RwLock<Option<String>>>,
}

const CONFIG_FILE_NAME: &str = "ainotework_mcp_config.json";

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct Config {
    api_key: Option<String>,
    notion_token: Option<String>,
    database_id: Option<String>,
    recent_databases: Option<Vec<RecentDatabase>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct RecentDatabase {
    pub id: String,
    pub name: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DatabaseInfo {
    pub id: String,
    pub name: String,
}

impl McpClient {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            stdout: Arc::new(Mutex::new(None)),
            request_id: AtomicU64::new(1),
            notion_token: Arc::new(tokio::sync::RwLock::new(None)),
            database_id: Arc::new(tokio::sync::RwLock::new(None)),
        }
    }

    fn get_config_path() -> Option<std::path::PathBuf> {
        dirs::config_dir().map(|p| p.join(CONFIG_FILE_NAME))
    }

    fn load_config() -> Config {
        if let Some(path) = Self::get_config_path() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
        Config::default()
    }

    fn save_config(config: &Config) -> Result<(), String> {
        let path = Self::get_config_path().ok_or("Could not determine config directory")?;
        let content = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&path, content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;
        Ok(())
    }

    pub async fn load_notion_token(&self) -> Option<String> {
        let config = Self::load_config();
        if let Some(token) = config.notion_token.clone() {
            let mut notion_token = self.notion_token.write().await;
            *notion_token = Some(token.clone());
            return Some(token);
        }
        None
    }

    pub async fn set_notion_token(&self, token: String) -> Result<(), String> {
        {
            let mut notion_token = self.notion_token.write().await;
            *notion_token = Some(token.clone());
        }

        let mut config = Self::load_config();
        config.notion_token = Some(token);
        Self::save_config(&config)?;
        Ok(())
    }

    pub async fn get_notion_token(&self) -> Option<String> {
        let notion_token = self.notion_token.read().await;
        notion_token.clone()
    }

    pub async fn load_database_id(&self) -> Option<String> {
        let config = Self::load_config();
        if let Some(db_id) = config.database_id.clone() {
            let mut database_id = self.database_id.write().await;
            *database_id = Some(db_id.clone());
            return Some(db_id);
        }
        None
    }

    pub async fn set_database_id(&self, db_id: String) -> Result<(), String> {
        {
            let mut database_id = self.database_id.write().await;
            *database_id = Some(db_id.clone());
        }

        let mut config = Self::load_config();
        config.database_id = Some(db_id);
        Self::save_config(&config)?;
        Ok(())
    }

    pub async fn get_database_id(&self) -> Option<String> {
        let database_id = self.database_id.read().await;
        database_id.clone()
    }

    pub fn load_recent_databases() -> Vec<RecentDatabase> {
        let config = Self::load_config();
        config.recent_databases.unwrap_or_default()
    }

    pub fn add_recent_database(db: RecentDatabase) -> Result<(), String> {
        let mut config = Self::load_config();
        let mut recent = config.recent_databases.unwrap_or_default();

        // Remove if already exists
        recent.retain(|r| r.id != db.id);

        // Add to front
        recent.insert(0, db);

        // Keep only last 10
        recent.truncate(10);

        config.recent_databases = Some(recent);
        Self::save_config(&config)
    }

    pub async fn list_tools(&self) -> Result<Vec<String>, String> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: self.next_id(),
            method: "tools/list".to_string(),
            params: None,
        };

        let result = self.send_request(&request).await?;
        let mut tool_names = Vec::new();

        if let Some(tools) = result.get("tools").and_then(|t| t.as_array()) {
            for tool in tools {
                if let Some(name) = tool.get("name").and_then(|n| n.as_str()) {
                    tool_names.push(name.to_string());
                }
            }
        }

        Ok(tool_names)
    }

    pub async fn search_databases(&self, query: &str) -> Result<Vec<DatabaseInfo>, String> {
        let tools = self.list_tools().await?;

        let search_tool_names = [
            "API-post-search",
            "search-notion",
            "notion_search",
            "API-search",
            "search",
            "notion-search",
        ];

        let search_tool = search_tool_names
            .iter()
            .find(|name| tools.iter().any(|t| t == *name));

        let tool_name = match search_tool {
            Some(name) => *name,
            None => {
                return Err(format!(
                    "No search tool found. Available tools: {:?}",
                    tools
                ));
            }
        };

        let result = self
            .call_tool(
                tool_name,
                json!({
                    "query": query,
                    "filter": {
                        "property": "object",
                        "value": "database"
                    }
                }),
            )
            .await;

        let result = match result {
            Ok(r) => r,
            Err(_) => {
                let r2 = self
                    .call_tool(
                        tool_name,
                        json!({
                            "query": query,
                            "filter": "database"
                        }),
                    )
                    .await;
                match r2 {
                    Ok(r) => r,
                    Err(_) => {
                        self.call_tool(tool_name, json!({ "query": query })).await?
                    }
                }
            }
        };

        let mut databases = Vec::new();

        if let Some(results) = result.get("results").and_then(|r| r.as_array()) {
            for item in results {
                let object_type = item.get("object").and_then(|o| o.as_str()).unwrap_or("");
                if object_type == "database" || query.is_empty() || object_type.is_empty() {
                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                        let name = Self::extract_database_name(item);
                        databases.push(DatabaseInfo {
                            id: id.to_string(),
                            name,
                        });
                    }
                }
            }
        }

        Ok(databases)
    }

    fn extract_database_name(db: &Value) -> String {
        if let Some(title) = db.get("title").and_then(|t| t.as_array()) {
            let name: String = title
                .iter()
                .filter_map(|t| t.get("plain_text").and_then(|pt| pt.as_str()))
                .collect::<Vec<_>>()
                .join("");
            if !name.is_empty() {
                return name;
            }
        }
        "Untitled".to_string()
    }

    pub async fn connect(&self, command: &str, args: &[&str]) -> Result<(), String> {
        let npx_paths = [
            command.to_string(),
            "/usr/local/bin/npx".to_string(),
            "/opt/homebrew/bin/npx".to_string(),
            format!("{}/bin/npx", std::env::var("HOME").unwrap_or_default()),
            format!("{}/.nvm/versions/node/*/bin/npx", std::env::var("HOME").unwrap_or_default()),
        ];

        let actual_command = if command == "npx" {
            npx_paths.iter()
                .find(|p| std::path::Path::new(p).exists())
                .cloned()
                .unwrap_or_else(|| command.to_string())
        } else {
            command.to_string()
        };

        let mut cmd = Command::new(&actual_command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        } else {
            cmd.env("PATH", "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin");
        }

        let token = self.notion_token.read().await;
        if let Some(ref t) = *token {
            cmd.env("NOTION_TOKEN", t);
        } else if let Ok(t) = std::env::var("NOTION_TOKEN") {
            cmd.env("NOTION_TOKEN", t);
        }
        drop(token);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start MCP server: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

        *self.process.lock().await = Some(child);
        *self.stdin.lock().await = Some(stdin);
        *self.stdout.lock().await = Some(BufReader::new(stdout));

        // Initialize with timeout
        match timeout(MCP_CONNECT_TIMEOUT, self.initialize()).await {
            Ok(result) => result?,
            Err(_) => {
                // Clean up on timeout
                self.disconnect().await.ok();
                return Err("MCP connection timed out (15 seconds). Please check if Notion token is valid.".to_string());
            }
        }

        Ok(())
    }

    async fn initialize(&self) -> Result<(), String> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: self.next_id(),
            method: "initialize".to_string(),
            params: Some(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "AINoteWork",
                    "version": "0.1.0"
                }
            })),
        };

        self.send_request(&request).await?;

        let notification = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        self.send_raw(&notification).await?;

        Ok(())
    }

    fn next_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::SeqCst)
    }

    async fn send_raw(&self, value: &Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or("MCP client not connected")?;

        let json_str = serde_json::to_string(value).map_err(|e| format!("Serialization error: {}", e))?;
        stdin
            .write_all(format!("{}\n", json_str).as_bytes())
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        stdin.flush().await.map_err(|e| format!("Flush error: {}", e))?;

        Ok(())
    }

    async fn send_request(&self, request: &JsonRpcRequest) -> Result<Value, String> {
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or("MCP client not connected")?;

        let json_str = serde_json::to_string(request).map_err(|e| format!("Serialization error: {}", e))?;
        stdin
            .write_all(format!("{}\n", json_str).as_bytes())
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        stdin.flush().await.map_err(|e| format!("Flush error: {}", e))?;

        let _ = stdin;

        let mut stdout = self.stdout.lock().await;
        let stdout = stdout.as_mut().ok_or("MCP client not connected")?;

        let mut line = String::new();
        let read_future = async {
            loop {
                line.clear();
                stdout
                    .read_line(&mut line)
                    .await
                    .map_err(|e| format!("Read error: {}", e))?;

                if line.trim().is_empty() {
                    continue;
                }

                let response: JsonRpcResponse =
                    serde_json::from_str(&line).map_err(|e| format!("Parse error: {} - Line: {}", e, line))?;

                if let Some(error) = response.error {
                    return Err(format!("MCP error: {}", error.message));
                }

                return response.result.ok_or_else(|| "Empty result".to_string());
            }
        };

        timeout(MCP_REQUEST_TIMEOUT, read_future)
            .await
            .map_err(|_| "MCP request timed out (30 seconds). Please check if Notion token is valid and MCP server is running.".to_string())?
    }

    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, String> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: self.next_id(),
            method: "tools/call".to_string(),
            params: Some(json!({
                "name": name,
                "arguments": arguments
            })),
        };

        let result = self.send_request(&request).await?;

        if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
            if let Some(first) = content.first() {
                if let Some(text) = first.get("text").and_then(|t| t.as_str()) {
                    return serde_json::from_str(text)
                        .map_err(|e| format!("Failed to parse tool response: {}", e));
                }
            }
        }

        Ok(result)
    }

    fn extract_page_id(input: &str) -> String {
        let input = input.trim();

        if let Some(id) = input
            .split(&['/', '?', '#', '-'][..])
            .filter(|s| s.len() == 32 && s.chars().all(|c| c.is_ascii_hexdigit()))
            .last()
        {
            return format!(
                "{}-{}-{}-{}-{}",
                &id[0..8],
                &id[8..12],
                &id[12..16],
                &id[16..20],
                &id[20..32]
            );
        }

        if input.len() == 36 && input.chars().filter(|&c| c == '-').count() == 4 {
            return input.to_string();
        }

        input.to_string()
    }

    pub async fn fetch_notion_page(&self, page_input: &str) -> Result<String, String> {
        let page_id = Self::extract_page_id(page_input);

        let page_result = self
            .call_tool("API-retrieve-a-page", json!({ "page_id": page_id }))
            .await?;

        if let Some(status) = page_result.get("status").and_then(|s| s.as_i64()) {
            if status != 200 {
                let message = page_result
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                return Err(format!("Notion API error ({}): {}", status, message));
            }
        }

        let mut content_parts: Vec<String> = Vec::new();

        if let Some(title) = Self::extract_page_title(&page_result) {
            content_parts.push(format!("# {}", title));
            content_parts.push(String::new());
        }

        let blocks_result = self
            .call_tool("API-get-block-children", json!({ "block_id": page_id }))
            .await?;

        if let Some(status) = blocks_result.get("status").and_then(|s| s.as_i64()) {
            if status != 200 {
                let message = blocks_result
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                return Err(format!("Notion API error ({}): {}", status, message));
            }
        }

        if let Some(results) = blocks_result.get("results").and_then(|r| r.as_array()) {
            for block in results {
                if let Some(text) = Self::extract_block_text(block) {
                    content_parts.push(text);
                }
            }
        }

        if content_parts.is_empty() {
            return Err(format!(
                "No content found in page. Debug - page_result keys: {:?}, blocks_result keys: {:?}",
                page_result.as_object().map(|o| o.keys().collect::<Vec<_>>()),
                blocks_result.as_object().map(|o| o.keys().collect::<Vec<_>>())
            ));
        }

        Ok(content_parts.join("\n"))
    }

    fn extract_page_title(page: &Value) -> Option<String> {
        if let Some(properties) = page.get("properties").and_then(|p| p.as_object()) {
            for (_key, prop) in properties {
                if prop.get("type").and_then(|t| t.as_str()) == Some("title") {
                    if let Some(title_arr) = prop.get("title").and_then(|t| t.as_array()) {
                        let title: String = title_arr
                            .iter()
                            .filter_map(|t| t.get("plain_text").and_then(|pt| pt.as_str()))
                            .collect::<Vec<_>>()
                            .join("");
                        if !title.is_empty() {
                            return Some(title);
                        }
                    }
                }
            }
        }
        None
    }

    fn extract_block_text(block: &Value) -> Option<String> {
        let block_type = block.get("type").and_then(|t| t.as_str())?;
        let type_content = block.get(block_type)?;

        if let Some(rich_text) = type_content.get("rich_text").and_then(|rt| rt.as_array()) {
            let text: String = rich_text
                .iter()
                .filter_map(|t| t.get("plain_text").and_then(|pt| pt.as_str()))
                .collect::<Vec<_>>()
                .join("");

            if text.is_empty() {
                return None;
            }

            return Some(match block_type {
                "heading_1" => format!("# {}", text),
                "heading_2" => format!("## {}", text),
                "heading_3" => format!("### {}", text),
                "bulleted_list_item" => format!("- {}", text),
                "numbered_list_item" => format!("1. {}", text),
                "quote" => format!("> {}", text),
                "code" => format!("```\n{}\n```", text),
                "to_do" => {
                    let checked = type_content
                        .get("checked")
                        .and_then(|c| c.as_bool())
                        .unwrap_or(false);
                    if checked {
                        format!("- [x] {}", text)
                    } else {
                        format!("- [ ] {}", text)
                    }
                }
                _ => text,
            });
        }

        None
    }

    pub async fn save_to_notion(
        &self,
        database_id: &str,
        title: &str,
        content: &str,
        _source_url: &str,
    ) -> Result<String, String> {
        let db_id = Self::extract_page_id(database_id);
        let blocks = self.markdown_to_blocks(content);

        let result = self
            .call_tool(
                "API-create-a-page",
                json!({
                    "parent": {
                        "database_id": db_id
                    },
                    "properties": {
                        "title": {
                            "title": [
                                {
                                    "text": {
                                        "content": title
                                    }
                                }
                            ]
                        }
                    },
                    "children": blocks
                }),
            )
            .await?;

        if let Some(status) = result.get("status").and_then(|s| s.as_i64()) {
            if status != 200 {
                let message = result
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                return Err(format!("Notion API error ({}): {}", status, message));
            }
        }

        result
            .get("id")
            .and_then(|id| id.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "Failed to get created page ID".to_string())
    }

    fn markdown_to_blocks(&self, content: &str) -> Vec<Value> {
        let mut blocks = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let block = if line.starts_with("## ") {
                json!({
                    "object": "block",
                    "type": "heading_2",
                    "heading_2": {
                        "rich_text": [{
                            "type": "text",
                            "text": { "content": &line[3..] }
                        }]
                    }
                })
            } else if line.starts_with("# ") {
                json!({
                    "object": "block",
                    "type": "heading_1",
                    "heading_1": {
                        "rich_text": [{
                            "type": "text",
                            "text": { "content": &line[2..] }
                        }]
                    }
                })
            } else if line == "---" {
                json!({
                    "object": "block",
                    "type": "divider",
                    "divider": {}
                })
            } else if line.starts_with("- ") {
                json!({
                    "object": "block",
                    "type": "bulleted_list_item",
                    "bulleted_list_item": {
                        "rich_text": [{
                            "type": "text",
                            "text": { "content": &line[2..] }
                        }]
                    }
                })
            } else {
                json!({
                    "object": "block",
                    "type": "paragraph",
                    "paragraph": {
                        "rich_text": [{
                            "type": "text",
                            "text": { "content": line }
                        }]
                    }
                })
            };

            blocks.push(block);
        }

        blocks
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        let mut process = self.process.lock().await;
        if let Some(mut child) = process.take() {
            child.kill().await.map_err(|e| format!("Failed to kill process: {}", e))?;
        }
        *self.stdin.lock().await = None;
        *self.stdout.lock().await = None;
        Ok(())
    }

    pub async fn is_connected(&self) -> bool {
        self.process.lock().await.is_some()
    }
}

impl Default for McpClient {
    fn default() -> Self {
        Self::new()
    }
}
