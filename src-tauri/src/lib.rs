mod ai_clients;
mod claude;
mod commands;
mod mcp;
mod web;

use ai_clients::AiClients;
use claude::ClaudeClient;
use commands::*;
use mcp::McpClient;
use web::WebClient;
use tauri::menu::{Menu, Submenu, AboutMetadata, PredefinedMenuItem};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Create custom About menu with creator info and build time
            let build_time = env!("BUILD_TIMESTAMP", "Unknown");

            let mut about_metadata = AboutMetadata::default();
            about_metadata.version = Some(format!("1.0.0 ({})", build_time));
            about_metadata.authors = Some(vec!["황원철".to_string()]);
            about_metadata.copyright = Some("Copyright © 2025 황원철. All rights reserved.".to_string());
            about_metadata.comments = Some("AI 기반 지능형 노트 & 문서 분석 도구".to_string());

            let about = PredefinedMenuItem::about(app, Some("AI Note Work 정보"), Some(about_metadata))?;
            let quit = PredefinedMenuItem::quit(app, Some("종료"))?;
            let hide = PredefinedMenuItem::hide(app, Some("AI Note Work 가리기"))?;
            let hide_others = PredefinedMenuItem::hide_others(app, Some("기타 가리기"))?;
            let show_all = PredefinedMenuItem::show_all(app, Some("모두 보기"))?;
            let separator = PredefinedMenuItem::separator(app)?;

            let app_menu = Submenu::with_items(
                app,
                "AI Note Work",
                true,
                &[&about, &separator, &hide, &hide_others, &show_all, &separator, &quit],
            )?;

            // Edit menu
            let undo = PredefinedMenuItem::undo(app, Some("실행 취소"))?;
            let redo = PredefinedMenuItem::redo(app, Some("다시 실행"))?;
            let cut = PredefinedMenuItem::cut(app, Some("오려두기"))?;
            let copy = PredefinedMenuItem::copy(app, Some("복사하기"))?;
            let paste = PredefinedMenuItem::paste(app, Some("붙여넣기"))?;
            let select_all = PredefinedMenuItem::select_all(app, Some("전체 선택"))?;
            let separator2 = PredefinedMenuItem::separator(app)?;

            let edit_menu = Submenu::with_items(
                app,
                "편집",
                true,
                &[&undo, &redo, &separator2, &cut, &copy, &paste, &select_all],
            )?;

            // Window menu
            let minimize = PredefinedMenuItem::minimize(app, Some("최소화"))?;
            let close = PredefinedMenuItem::close_window(app, Some("닫기"))?;
            let separator3 = PredefinedMenuItem::separator(app)?;
            let fullscreen = PredefinedMenuItem::fullscreen(app, Some("전체 화면"))?;

            let window_menu = Submenu::with_items(
                app,
                "윈도우",
                true,
                &[&minimize, &separator3, &fullscreen, &separator3, &close],
            )?;

            let menu = Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])?;
            app.set_menu(menu)?;

            Ok(())
        })
        .manage(ClaudeClient::new())
        .manage(McpClient::new())
        .manage(WebClient::new())
        .manage(AiClients::new())
        .invoke_handler(tauri::generate_handler![
            set_api_key,
            load_api_key,
            get_api_key,
            clear_api_key,
            set_notion_token,
            load_notion_token,
            get_notion_token,
            set_database_id,
            load_database_id,
            connect_mcp,
            disconnect_mcp,
            is_mcp_connected,
            fetch_notion_page,
            fetch_web_page,
            translate,
            summarize,
            ask_question,
            ask_question_openai,
            ask_question_gemini,
            set_openai_key,
            load_openai_key,
            get_openai_key,
            clear_openai_key,
            set_gemini_key,
            load_gemini_key,
            get_gemini_key,
            clear_gemini_key,
            save_to_notion,
            search_databases,
            load_recent_databases,
            add_recent_database,
            list_mcp_tools,
            export_notes_to_file,
            translate_content,
            summarize_content,
            ask_claude_content,
            ask_openai_content,
            ask_gemini_content,
            ask_with_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
