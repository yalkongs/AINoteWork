use reqwest::Client;
use scraper::{Html, Selector};

pub struct WebClient {
    client: Client,
}

impl WebClient {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    pub async fn fetch_page(&self, url: &str) -> Result<String, String> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch page: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("HTTP error: {}", response.status()));
        }

        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        Ok(self.extract_text(&html))
    }

    fn extract_text(&self, html: &str) -> String {
        let document = Html::parse_document(html);
        let mut text_parts: Vec<String> = Vec::new();

        if let Ok(title_selector) = Selector::parse("title") {
            if let Some(title) = document.select(&title_selector).next() {
                text_parts.push(format!("Title: {}", title.text().collect::<String>().trim()));
                text_parts.push(String::new());
            }
        }

        let content_selectors = [
            "article",
            "main",
            "[role='main']",
            ".content",
            ".post-content",
            ".article-content",
            ".entry-content",
            "#content",
        ];

        let mut found_content = false;
        for selector_str in content_selectors {
            if let Ok(selector) = Selector::parse(selector_str) {
                for element in document.select(&selector) {
                    let text = Self::extract_element_text(&element);
                    if !text.trim().is_empty() {
                        text_parts.push(text);
                        found_content = true;
                    }
                }
                if found_content {
                    break;
                }
            }
        }

        if !found_content {
            if let Ok(body_selector) = Selector::parse("body") {
                if let Some(body) = document.select(&body_selector).next() {
                    text_parts.push(Self::extract_element_text(&body));
                }
            }
        }

        text_parts.join("\n").trim().to_string()
    }

    fn extract_element_text(element: &scraper::ElementRef) -> String {
        let mut texts: Vec<String> = Vec::new();

        for text in element.text() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                texts.push(trimmed.to_string());
            }
        }

        texts.join(" ")
    }
}

impl Default for WebClient {
    fn default() -> Self {
        Self::new()
    }
}
