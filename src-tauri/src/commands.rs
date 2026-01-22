use crate::ai_clients::AiClients;
use crate::claude::ClaudeClient;
use crate::mcp::{DatabaseInfo, McpClient, RecentDatabase};
use crate::web::WebClient;
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub async fn set_api_key(claude: State<'_, ClaudeClient>, api_key: String) -> Result<(), String> {
    claude.set_api_key(api_key).await
}

#[tauri::command]
pub async fn load_api_key(claude: State<'_, ClaudeClient>) -> Result<Option<String>, String> {
    Ok(claude.load_api_key().await)
}

#[tauri::command]
pub async fn get_api_key(claude: State<'_, ClaudeClient>) -> Result<Option<String>, String> {
    Ok(claude.get_api_key().await)
}

#[tauri::command]
pub async fn clear_api_key(claude: State<'_, ClaudeClient>) -> Result<(), String> {
    claude.clear_api_key().await
}

#[tauri::command]
pub async fn set_notion_token(mcp: State<'_, McpClient>, token: String) -> Result<(), String> {
    mcp.set_notion_token(token).await
}

#[tauri::command]
pub async fn load_notion_token(mcp: State<'_, McpClient>) -> Result<Option<String>, String> {
    Ok(mcp.load_notion_token().await)
}

#[tauri::command]
pub async fn get_notion_token(mcp: State<'_, McpClient>) -> Result<Option<String>, String> {
    Ok(mcp.get_notion_token().await)
}

#[tauri::command]
pub async fn connect_mcp(
    mcp: State<'_, McpClient>,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    mcp.connect(&command, &args_refs).await
}

#[tauri::command]
pub async fn disconnect_mcp(mcp: State<'_, McpClient>) -> Result<(), String> {
    mcp.disconnect().await
}

#[tauri::command]
pub async fn is_mcp_connected(mcp: State<'_, McpClient>) -> Result<bool, String> {
    Ok(mcp.is_connected().await)
}

#[tauri::command]
pub async fn fetch_notion_page(mcp: State<'_, McpClient>, page_url: String) -> Result<String, String> {
    mcp.fetch_notion_page(&page_url).await
}

#[tauri::command]
pub async fn fetch_web_page(web: State<'_, WebClient>, url: String) -> Result<String, String> {
    web.fetch_page(&url).await
}

/// Determine if URL is a Notion page or regular web page
fn is_notion_url(url: &str) -> bool {
    url.contains("notion.so") || url.contains("notion.site")
}

#[tauri::command]
pub async fn translate(
    mcp: State<'_, McpClient>,
    web: State<'_, WebClient>,
    claude: State<'_, ClaudeClient>,
    page_url: String,
    target_language: String,
) -> Result<String, String> {
    let content = if is_notion_url(&page_url) {
        mcp.fetch_notion_page(&page_url).await?
    } else {
        web.fetch_page(&page_url).await?
    };
    claude.translate(&content, &target_language).await
}

#[tauri::command]
pub async fn summarize(
    mcp: State<'_, McpClient>,
    web: State<'_, WebClient>,
    claude: State<'_, ClaudeClient>,
    page_url: String,
) -> Result<String, String> {
    let content = if is_notion_url(&page_url) {
        mcp.fetch_notion_page(&page_url).await?
    } else {
        web.fetch_page(&page_url).await?
    };
    claude.summarize(&content).await
}

#[tauri::command]
pub async fn ask_question(
    mcp: State<'_, McpClient>,
    web: State<'_, WebClient>,
    claude: State<'_, ClaudeClient>,
    page_url: String,
    question: String,
) -> Result<String, String> {
    let content = if is_notion_url(&page_url) {
        mcp.fetch_notion_page(&page_url).await?
    } else {
        web.fetch_page(&page_url).await?
    };
    claude.ask_question(&content, &question).await
}

#[tauri::command]
pub async fn set_database_id(mcp: State<'_, McpClient>, database_id: String) -> Result<(), String> {
    mcp.set_database_id(database_id).await
}

#[tauri::command]
pub async fn load_database_id(mcp: State<'_, McpClient>) -> Result<Option<String>, String> {
    Ok(mcp.load_database_id().await)
}

#[tauri::command]
pub async fn save_to_notion(
    mcp: State<'_, McpClient>,
    database_id: String,
    title: String,
    content: String,
    source_url: String,
) -> Result<String, String> {
    mcp.save_to_notion(&database_id, &title, &content, &source_url).await
}

#[tauri::command]
pub async fn search_databases(
    mcp: State<'_, McpClient>,
    query: String,
) -> Result<Vec<DatabaseInfo>, String> {
    mcp.search_databases(&query).await
}

#[tauri::command]
pub fn load_recent_databases() -> Result<Vec<RecentDatabase>, String> {
    Ok(McpClient::load_recent_databases())
}

#[tauri::command]
pub fn add_recent_database(id: String, name: String) -> Result<(), String> {
    McpClient::add_recent_database(RecentDatabase { id, name })
}

#[tauri::command]
pub async fn list_mcp_tools(mcp: State<'_, McpClient>) -> Result<Vec<String>, String> {
    mcp.list_tools().await
}

// OpenAI Commands
#[tauri::command]
pub async fn set_openai_key(ai: State<'_, AiClients>, api_key: String) -> Result<(), String> {
    ai.set_openai_key(api_key).await
}

#[tauri::command]
pub async fn load_openai_key(ai: State<'_, AiClients>) -> Result<Option<String>, String> {
    Ok(ai.load_openai_key().await)
}

#[tauri::command]
pub async fn get_openai_key(ai: State<'_, AiClients>) -> Result<Option<String>, String> {
    Ok(ai.get_openai_key().await)
}

#[tauri::command]
pub async fn clear_openai_key(ai: State<'_, AiClients>) -> Result<(), String> {
    ai.clear_openai_key().await
}

#[tauri::command]
pub async fn ask_question_openai(
    mcp: State<'_, McpClient>,
    web: State<'_, WebClient>,
    ai: State<'_, AiClients>,
    page_url: String,
    question: String,
) -> Result<String, String> {
    let content = if is_notion_url(&page_url) {
        mcp.fetch_notion_page(&page_url).await?
    } else {
        web.fetch_page(&page_url).await?
    };
    ai.ask_openai(&content, &question).await
}

// Gemini Commands
#[tauri::command]
pub async fn set_gemini_key(ai: State<'_, AiClients>, api_key: String) -> Result<(), String> {
    ai.set_gemini_key(api_key).await
}

#[tauri::command]
pub async fn load_gemini_key(ai: State<'_, AiClients>) -> Result<Option<String>, String> {
    Ok(ai.load_gemini_key().await)
}

#[tauri::command]
pub async fn get_gemini_key(ai: State<'_, AiClients>) -> Result<Option<String>, String> {
    Ok(ai.get_gemini_key().await)
}

#[tauri::command]
pub async fn clear_gemini_key(ai: State<'_, AiClients>) -> Result<(), String> {
    ai.clear_gemini_key().await
}

#[tauri::command]
pub async fn ask_question_gemini(
    mcp: State<'_, McpClient>,
    web: State<'_, WebClient>,
    ai: State<'_, AiClients>,
    page_url: String,
    question: String,
) -> Result<String, String> {
    let content = if is_notion_url(&page_url) {
        mcp.fetch_notion_page(&page_url).await?
    } else {
        web.fetch_page(&page_url).await?
    };
    ai.ask_gemini(&content, &question).await
}

// File Export Command
#[tauri::command]
pub async fn export_notes_to_file(
    file_path: String,
    content: String,
) -> Result<(), String> {
    std::fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

// Content-based API Commands (no URL fetch needed)
#[tauri::command]
pub async fn translate_content(
    claude: State<'_, ClaudeClient>,
    content: String,
    target_language: String,
) -> Result<String, String> {
    claude.translate(&content, &target_language).await
}

#[tauri::command]
pub async fn summarize_content(
    claude: State<'_, ClaudeClient>,
    content: String,
) -> Result<String, String> {
    claude.summarize(&content).await
}

#[tauri::command]
pub async fn ask_claude_content(
    claude: State<'_, ClaudeClient>,
    content: String,
    question: String,
) -> Result<String, String> {
    claude.ask_question(&content, &question).await
}

#[tauri::command]
pub async fn ask_openai_content(
    ai: State<'_, AiClients>,
    content: String,
    question: String,
) -> Result<String, String> {
    ai.ask_openai(&content, &question).await
}

#[tauri::command]
pub async fn ask_gemini_content(
    ai: State<'_, AiClients>,
    content: String,
    question: String,
) -> Result<String, String> {
    ai.ask_gemini(&content, &question).await
}

// Follow-up question with conversation history
#[tauri::command]
pub async fn ask_with_history(
    claude: State<'_, ClaudeClient>,
    ai: State<'_, AiClients>,
    model: String,
    messages: Vec<ConversationMessage>,
    content: String,
) -> Result<String, String> {
    // Build messages with context
    let system_prompt = format!(
        "당신은 해당 분야의 전문가입니다. 다음 문서를 바탕으로 질문에 전문적이고 상세하게 답변해주세요.\n\n\
        ## 답변 가이드라인:\n\
        - 전문 용어가 있다면 쉽게 설명해주세요\n\
        - 관련 배경 지식도 함께 제공해주세요\n\
        - 실용적인 예시나 활용 방안이 있다면 포함해주세요\n\
        - 논리적인 구조로 답변을 구성해주세요\n\
        - 이전 대화 맥락을 고려해서 답변해주세요\n\n\
        ## 참고 문서:\n{}\n\n\
        반드시 한글로 상세하게 답변해주세요.",
        content
    );

    match model.as_str() {
        "claude" => {
            let mut claude_messages: Vec<crate::claude::Message> = Vec::new();

            // Add system context as first user message
            claude_messages.push(crate::claude::Message {
                role: "user".to_string(),
                content: system_prompt.clone(),
            });
            claude_messages.push(crate::claude::Message {
                role: "assistant".to_string(),
                content: "네, 문서를 이해했습니다. 질문해주세요.".to_string(),
            });

            // Add conversation history
            for msg in messages {
                claude_messages.push(crate::claude::Message {
                    role: msg.role,
                    content: msg.content,
                });
            }

            claude.send_messages(claude_messages).await
        }
        "openai" => {
            let mut openai_messages: Vec<crate::ai_clients::OpenAiMessage> = Vec::new();

            // Add system context
            openai_messages.push(crate::ai_clients::OpenAiMessage {
                role: "system".to_string(),
                content: system_prompt,
            });

            // Add conversation history
            for msg in messages {
                openai_messages.push(crate::ai_clients::OpenAiMessage {
                    role: msg.role,
                    content: msg.content,
                });
            }

            ai.ask_openai_with_history(openai_messages).await
        }
        "gemini" => {
            // Gemini doesn't support system messages, so we include it in first user message
            let mut first_message = system_prompt.clone();
            if let Some(first) = messages.first() {
                first_message = format!("{}\n\n사용자 질문: {}", system_prompt, first.content);
            }

            // For Gemini, just use the simple ask method with the combined prompt
            if messages.len() > 1 {
                // Include conversation history in prompt
                let history: Vec<String> = messages.iter()
                    .map(|m| format!("{}: {}", if m.role == "user" { "사용자" } else { "AI" }, m.content))
                    .collect();
                let combined = format!("{}\n\n이전 대화:\n{}", first_message, history.join("\n"));
                ai.ask_gemini(&content, &combined).await
            } else if let Some(msg) = messages.last() {
                ai.ask_gemini(&content, &msg.content).await
            } else {
                Err("No messages provided".to_string())
            }
        }
        _ => Err(format!("Unknown model: {}", model)),
    }
}

// Extract text from file data (base64 encoded)
#[tauri::command]
pub async fn extract_text_from_file(
    file_data: String,
    file_type: String,
) -> Result<String, String> {
    use base64::Engine;

    // Decode base64 data URL
    let data = if file_data.contains(",") {
        // Data URL format: data:mime;base64,xxxxx
        file_data.split(',').nth(1).unwrap_or(&file_data)
    } else {
        &file_data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    match file_type.as_str() {
        "pdf" => extract_pdf_text(&bytes),
        "xls" | "xlsx" => extract_excel_text(&bytes, &file_type),
        "doc" | "docx" | "ppt" | "pptx" => {
            // For Office formats, we return a placeholder message
            // Full extraction would require additional libraries
            Ok(format!(
                "[{} 파일]\n\n이 파일 형식의 텍스트 추출은 현재 지원되지 않습니다.\n\
                PDF 또는 Excel 파일을 사용하시거나, 텍스트를 직접 복사하여 붙여넣기 해주세요.",
                file_type.to_uppercase()
            ))
        }
        "image" => {
            Ok("[이미지 파일]\n\n이미지에서 텍스트를 추출하려면 OCR이 필요합니다.\n\
                현재는 이미지 미리보기만 지원됩니다.".to_string())
        }
        _ => Err(format!("Unsupported file type: {}", file_type)),
    }
}

fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(bytes)
        .map_err(|e| format!("Failed to extract PDF text: {}", e))
}

fn extract_excel_text(bytes: &[u8], file_type: &str) -> Result<String, String> {
    use calamine::{Reader, Xlsx, Xls};
    use std::io::Cursor;

    let cursor = Cursor::new(bytes);
    let mut result = String::new();

    match file_type {
        "xlsx" => {
            let mut workbook: Xlsx<_> = calamine::open_workbook_from_rs(cursor)
                .map_err(|e| format!("Failed to open xlsx: {}", e))?;

            for sheet_name in workbook.sheet_names().to_vec() {
                result.push_str(&format!("## Sheet: {}\n\n", sheet_name));
                if let Ok(range) = workbook.worksheet_range(&sheet_name) {
                    for row in range.rows() {
                        let row_str: Vec<String> = row.iter()
                            .map(|cell| cell.to_string())
                            .collect();
                        result.push_str(&row_str.join("\t"));
                        result.push('\n');
                    }
                }
                result.push('\n');
            }
        }
        "xls" => {
            let mut workbook: Xls<_> = calamine::open_workbook_from_rs(cursor)
                .map_err(|e| format!("Failed to open xls: {}", e))?;

            for sheet_name in workbook.sheet_names().to_vec() {
                result.push_str(&format!("## Sheet: {}\n\n", sheet_name));
                if let Ok(range) = workbook.worksheet_range(&sheet_name) {
                    for row in range.rows() {
                        let row_str: Vec<String> = row.iter()
                            .map(|cell| cell.to_string())
                            .collect();
                        result.push_str(&row_str.join("\t"));
                        result.push('\n');
                    }
                }
                result.push('\n');
            }
        }
        _ => return Err(format!("Unsupported Excel format: {}", file_type)),
    }

    Ok(result)
}
