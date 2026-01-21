use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";
const GEMINI_API_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const AI_CONFIG_FILE_NAME: &str = "ainotework_ai_config.json";

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct AiConfig {
    pub openai_api_key: Option<String>,
    pub gemini_api_key: Option<String>,
}

// OpenAI Types
#[derive(Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    max_tokens: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OpenAiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiError {
    error: OpenAiErrorDetail,
}

#[derive(Deserialize)]
struct OpenAiErrorDetail {
    message: String,
}

// Gemini Types
#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Serialize, Deserialize, Clone)]
struct GeminiContent {
    #[serde(default)]
    parts: Vec<GeminiPart>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    role: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct GeminiPart {
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    error: Option<GeminiError>,
}

#[derive(Deserialize, Clone)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Deserialize)]
struct GeminiError {
    message: String,
}

pub struct AiClients {
    client: Client,
    openai_api_key: Arc<RwLock<Option<String>>>,
    gemini_api_key: Arc<RwLock<Option<String>>>,
}

impl AiClients {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))  // 60 second timeout
            .connect_timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            openai_api_key: Arc::new(RwLock::new(None)),
            gemini_api_key: Arc::new(RwLock::new(None)),
        }
    }

    fn get_config_path() -> Option<PathBuf> {
        dirs::config_dir().map(|p| p.join(AI_CONFIG_FILE_NAME))
    }

    fn load_config() -> AiConfig {
        if let Some(path) = Self::get_config_path() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
        AiConfig::default()
    }

    fn save_config(config: &AiConfig) -> Result<(), String> {
        let path = Self::get_config_path().ok_or("Could not determine config directory")?;
        let content = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&path, content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;
        Ok(())
    }

    // OpenAI Methods
    pub async fn load_openai_key(&self) -> Option<String> {
        let config = Self::load_config();
        if let Some(key) = config.openai_api_key.clone() {
            let mut api_key = self.openai_api_key.write().await;
            *api_key = Some(key.clone());
            return Some(key);
        }
        None
    }

    pub async fn set_openai_key(&self, key: String) -> Result<(), String> {
        {
            let mut api_key = self.openai_api_key.write().await;
            *api_key = Some(key.clone());
        }
        let mut config = Self::load_config();
        config.openai_api_key = Some(key);
        Self::save_config(&config)?;
        Ok(())
    }

    pub async fn get_openai_key(&self) -> Option<String> {
        let api_key = self.openai_api_key.read().await;
        api_key.clone()
    }

    pub async fn clear_openai_key(&self) -> Result<(), String> {
        {
            let mut api_key = self.openai_api_key.write().await;
            *api_key = None;
        }
        let mut config = Self::load_config();
        config.openai_api_key = None;
        Self::save_config(&config)?;
        Ok(())
    }

    // Gemini Methods
    pub async fn load_gemini_key(&self) -> Option<String> {
        let config = Self::load_config();
        if let Some(key) = config.gemini_api_key.clone() {
            let mut api_key = self.gemini_api_key.write().await;
            *api_key = Some(key.clone());
            return Some(key);
        }
        None
    }

    pub async fn set_gemini_key(&self, key: String) -> Result<(), String> {
        {
            let mut api_key = self.gemini_api_key.write().await;
            *api_key = Some(key.clone());
        }
        let mut config = Self::load_config();
        config.gemini_api_key = Some(key);
        Self::save_config(&config)?;
        Ok(())
    }

    pub async fn get_gemini_key(&self) -> Option<String> {
        let api_key = self.gemini_api_key.read().await;
        api_key.clone()
    }

    pub async fn clear_gemini_key(&self) -> Result<(), String> {
        {
            let mut api_key = self.gemini_api_key.write().await;
            *api_key = None;
        }
        let mut config = Self::load_config();
        config.gemini_api_key = None;
        Self::save_config(&config)?;
        Ok(())
    }

    // OpenAI Ask
    pub async fn ask_openai(&self, content: &str, question: &str) -> Result<String, String> {
        let api_key = self.openai_api_key.read().await;
        let api_key = api_key.as_ref().ok_or("OpenAI API key not set")?;

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

        let request = OpenAiRequest {
            model: "gpt-4o-mini".to_string(),
            messages: vec![OpenAiMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            max_tokens: 4096,
        };

        let response = self
            .client
            .post(OPENAI_API_URL)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("OpenAI request failed: {}", e))?;

        let status = response.status();
        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<OpenAiError>(&body) {
                return Err(format!("OpenAI error: {}", error.error.message));
            }
            return Err(format!("OpenAI error ({}): {}", status, body));
        }

        let response: OpenAiResponse =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {}", e))?;

        response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| "Empty response from OpenAI".to_string())
    }

    pub async fn ask_openai_with_history(&self, messages: Vec<OpenAiMessage>) -> Result<String, String> {
        let api_key = self.openai_api_key.read().await;
        let api_key = api_key.as_ref().ok_or("OpenAI API key not set")?;

        let request = OpenAiRequest {
            model: "gpt-4o-mini".to_string(),
            messages,
            max_tokens: 4096,
        };

        let response = self
            .client
            .post(OPENAI_API_URL)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("OpenAI request failed: {}", e))?;

        let status = response.status();
        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<OpenAiError>(&body) {
                return Err(format!("OpenAI error: {}", error.error.message));
            }
            return Err(format!("OpenAI error ({}): {}", status, body));
        }

        let response: OpenAiResponse =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {}", e))?;

        response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| "Empty response from OpenAI".to_string())
    }

    // Gemini Ask
    pub async fn ask_gemini(&self, content: &str, question: &str) -> Result<String, String> {
        let api_key = self.gemini_api_key.read().await;
        let api_key = api_key.as_ref().ok_or("Gemini API key not set")?;

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

        let request = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: prompt }],
                role: Some("user".to_string()),
            }],
        };

        let url = format!("{}?key={}", GEMINI_API_URL, api_key);

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Gemini request failed: {}", e))?;

        let status = response.status();
        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            return Err(format!("Gemini error ({}): {}", status, body));
        }

        let response: GeminiResponse =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {} - Body: {}", e, &body[..body.len().min(500)]))?;

        if let Some(error) = response.error {
            return Err(format!("Gemini error: {}", error.message));
        }

        if let Some(candidates) = response.candidates {
            if let Some(candidate) = candidates.first() {
                if let Some(part) = candidate.content.parts.first() {
                    if !part.text.is_empty() {
                        return Ok(part.text.clone());
                    }
                }
            }
        }

        Err(format!("Empty response from Gemini. Raw: {}", &body[..body.len().min(500)]))
    }

    pub async fn ask_gemini_with_history(&self, messages: Vec<GeminiContent>) -> Result<String, String> {
        let api_key = self.gemini_api_key.read().await;
        let api_key = api_key.as_ref().ok_or("Gemini API key not set")?;

        let request = GeminiRequest {
            contents: messages,
        };

        let url = format!("{}?key={}", GEMINI_API_URL, api_key);

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Gemini request failed: {}", e))?;

        let status = response.status();
        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            return Err(format!("Gemini error ({}): {}", status, body));
        }

        let response: GeminiResponse =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {} - Body: {}", e, &body[..body.len().min(500)]))?;

        if let Some(error) = response.error {
            return Err(format!("Gemini error: {}", error.message));
        }

        if let Some(candidates) = response.candidates {
            if let Some(candidate) = candidates.first() {
                if let Some(part) = candidate.content.parts.first() {
                    if !part.text.is_empty() {
                        return Ok(part.text.clone());
                    }
                }
            }
        }

        Err(format!("Empty response from Gemini. Raw: {}", &body[..body.len().min(500)]))
    }
}

impl Default for AiClients {
    fn default() -> Self {
        Self::new()
    }
}
