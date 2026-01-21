use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";
const CONFIG_FILE_NAME: &str = "ainotework_config.json";

#[derive(Serialize, Deserialize, Default)]
struct Config {
    api_key: Option<String>,
}

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeError {
    error: ErrorDetail,
}

#[derive(Deserialize)]
struct ErrorDetail {
    message: String,
}

pub struct ClaudeClient {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl ClaudeClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))  // 2 minute timeout for long translations
            .connect_timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    fn get_config_path() -> Option<PathBuf> {
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

    pub async fn load_api_key(&self) -> Option<String> {
        let config = Self::load_config();
        if let Some(key) = config.api_key.clone() {
            let mut api_key = self.api_key.write().await;
            *api_key = Some(key.clone());
            return Some(key);
        }
        None
    }

    pub async fn set_api_key(&self, key: String) -> Result<(), String> {
        {
            let mut api_key = self.api_key.write().await;
            *api_key = Some(key.clone());
        }
        let config = Config {
            api_key: Some(key),
        };
        Self::save_config(&config)?;
        Ok(())
    }

    pub async fn get_api_key(&self) -> Option<String> {
        let api_key = self.api_key.read().await;
        api_key.clone()
    }

    pub async fn clear_api_key(&self) -> Result<(), String> {
        {
            let mut api_key = self.api_key.write().await;
            *api_key = None;
        }
        let config = Config { api_key: None };
        Self::save_config(&config)?;
        Ok(())
    }

    pub async fn send_message(&self, prompt: &str) -> Result<String, String> {
        let api_key = self.api_key.read().await;
        let api_key = api_key.as_ref().ok_or("API key not set")?;

        let request = ClaudeRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            max_tokens: 4096,  // Reduced for faster responses
            messages: vec![Message {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
        };

        let response = self
            .client
            .post(CLAUDE_API_URL)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "Request timed out. Please try again or use shorter content.".to_string()
                } else if e.is_connect() {
                    "Connection failed. Please check your internet connection.".to_string()
                } else {
                    format!("Network error: {}. Please check your connection.", e)
                }
            })?;

        let status = response.status();
        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<ClaudeError>(&body) {
                return Err(format!("API error: {}", error.error.message));
            }
            return Err(format!("API error ({}): {}", status, body));
        }

        let response: ClaudeResponse =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {}", e))?;

        response
            .content
            .first()
            .and_then(|block| block.text.clone())
            .ok_or_else(|| "Empty response from Claude".to_string())
    }

    pub async fn send_messages(&self, messages: Vec<Message>) -> Result<String, String> {
        let api_key = self.api_key.read().await;
        let api_key = api_key.as_ref().ok_or("API key not set")?;

        let request = ClaudeRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            max_tokens: 4096,  // Reduced for faster responses
            messages,
        };

        let response = self
            .client
            .post(CLAUDE_API_URL)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "Request timed out. Please try again or use shorter content.".to_string()
                } else if e.is_connect() {
                    "Connection failed. Please check your internet connection.".to_string()
                } else {
                    format!("Network error: {}. Please check your connection.", e)
                }
            })?;

        let status = response.status();
        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<ClaudeError>(&body) {
                return Err(format!("API error: {}", error.error.message));
            }
            return Err(format!("API error ({}): {}", status, body));
        }

        let response: ClaudeResponse =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {}", e))?;

        response
            .content
            .first()
            .and_then(|block| block.text.clone())
            .ok_or_else(|| "Empty response from Claude".to_string())
    }

    /// Estimate token count (rough approximation: ~3 chars per token for mixed content)
    fn estimate_tokens(text: &str) -> usize {
        text.len() / 3
    }

    /// Split content into chunks that fit within token limits
    /// Tries to split at paragraph boundaries for better context
    fn split_content_for_translation(content: &str, max_chars: usize) -> Vec<String> {
        let mut chunks = Vec::new();
        let paragraphs: Vec<&str> = content.split("\n\n").collect();
        let mut current_chunk = String::new();

        for para in paragraphs {
            // If single paragraph exceeds limit, split by sentences
            if para.len() > max_chars {
                if !current_chunk.is_empty() {
                    chunks.push(current_chunk.clone());
                    current_chunk.clear();
                }

                // Split by sentences (period, question mark, exclamation)
                let sentences: Vec<&str> = para.split_inclusive(|c| c == '.' || c == '?' || c == '!' || c == '。' || c == '？' || c == '！')
                    .collect();

                for sentence in sentences {
                    if current_chunk.len() + sentence.len() > max_chars {
                        if !current_chunk.is_empty() {
                            chunks.push(current_chunk.clone());
                            current_chunk.clear();
                        }
                        // If single sentence is still too long, just add it as is
                        if sentence.len() > max_chars {
                            chunks.push(sentence.to_string());
                        } else {
                            current_chunk = sentence.to_string();
                        }
                    } else {
                        current_chunk.push_str(sentence);
                    }
                }
            } else if current_chunk.len() + para.len() + 2 > max_chars {
                // Current chunk would exceed limit, save it and start new
                if !current_chunk.is_empty() {
                    chunks.push(current_chunk.clone());
                }
                current_chunk = para.to_string();
            } else {
                // Add paragraph to current chunk
                if !current_chunk.is_empty() {
                    current_chunk.push_str("\n\n");
                }
                current_chunk.push_str(para);
            }
        }

        // Don't forget the last chunk
        if !current_chunk.is_empty() {
            chunks.push(current_chunk);
        }

        // If no chunks were created, return the original content
        if chunks.is_empty() {
            chunks.push(content.to_string());
        }

        chunks
    }

    pub async fn translate(&self, content: &str, target_lang: &str) -> Result<String, String> {
        // Max chars per chunk (~2500 tokens worth, leaving room for prompt and response)
        const MAX_CHUNK_CHARS: usize = 6000;

        let estimated_tokens = Self::estimate_tokens(content);

        // If content is small enough, translate in one go
        if estimated_tokens < 2000 {
            let prompt = format!(
                "Translate the following content to {}. Only provide the translation, no explanations:\n\n{}",
                target_lang, content
            );
            return self.send_message(&prompt).await;
        }

        // Split content into manageable chunks
        let chunks = Self::split_content_for_translation(content, MAX_CHUNK_CHARS);
        let total_chunks = chunks.len();

        let mut translated_parts = Vec::new();

        for (i, chunk) in chunks.iter().enumerate() {
            let prompt = if total_chunks > 1 {
                format!(
                    "Translate the following content to {}. This is part {} of {} parts. \
                    Only provide the translation, maintain consistency with previous parts, no explanations:\n\n{}",
                    target_lang, i + 1, total_chunks, chunk
                )
            } else {
                format!(
                    "Translate the following content to {}. Only provide the translation, no explanations:\n\n{}",
                    target_lang, chunk
                )
            };

            let translated = self.send_message(&prompt).await?;
            translated_parts.push(translated);
        }

        // Join all translated parts
        Ok(translated_parts.join("\n\n"))
    }

    pub async fn summarize(&self, content: &str) -> Result<String, String> {
        let prompt = format!(
            "다음 내용을 핵심 포인트 중심으로 간결하게 요약해주세요. 반드시 한글로 작성해주세요.\n\n{}",
            content
        );
        self.send_message(&prompt).await
    }

    pub async fn ask_question(&self, content: &str, question: &str) -> Result<String, String> {
        let prompt = format!(
            "당신은 해당 분야의 전문가입니다. 다음 문서를 바탕으로 질문에 전문적이고 상세하게 답변해주세요.\n\n\
            ## 답변 가이드라인:\n\
            - 전문 용어가 있다면 쉽게 설명해주세요\n\
            - 관련 배경 지식도 함께 제공해주세요\n\
            - 실용적인 예시나 활용 방안이 있다면 포함해주세요\n\
            - 논리적인 구조로 답변을 구성해주세요\n\n\
            ## 질문:\n{}\n\n\
            ## 참고 문서:\n{}\n\n\
            반드시 한글로 상세하게 답변해주세요.",
            question, content
        );
        self.send_message(&prompt).await
    }
}

impl Default for ClaudeClient {
    fn default() -> Self {
        Self::new()
    }
}
