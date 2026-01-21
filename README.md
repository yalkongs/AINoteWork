# AI Note Work

AI 기반 지능형 노트 & 문서 분석 도구

## 소개

AI Note Work는 Notion 페이지, 웹 페이지, 또는 직접 입력한 텍스트를 AI로 분석하여 번역, 요약, 질문응답 기능을 제공하는 macOS 데스크톱 앱입니다.

## 주요 기능

### 다중 AI 모델 지원
- **Claude** (Anthropic) - claude-sonnet-4-20250514
- **GPT-4o-mini** (OpenAI)
- **Gemini 2.0 Flash** (Google)

### 문서 분석
- **번역**: 문서를 한국어로 번역
- **요약**: 핵심 내용을 간결하게 요약
- **질문응답**: 문서 내용에 대해 AI에게 질문
- **멀티모델 비교**: 동일한 질문을 여러 AI 모델에 동시에 전송하여 결과 비교

### 템플릿 분석
- **요점 정리**: 핵심 포인트를 체계적으로 정리
- **Deep Research**: 심층 분석 및 배경 지식 제공
- **연관 주제 추출**: 관련 주제 및 확장 학습 방향 제시

### 소스 관리
- Notion 페이지 URL 로드
- 웹 페이지 URL 로드
- 직접 텍스트 입력
- 다중 소스 관리 및 색상 구분

### 노트 관리
- AI 분석 결과 자동 저장
- 태그 기반 분류
- 중요 노트 표시
- Markdown/텍스트 파일 내보내기
- Notion 데이터베이스로 저장

### 기타 기능
- 다크/라이트 테마
- 키보드 단축키
- 프롬프트 프리셋
- 대화 히스토리 유지

## 기술 스택

- **프레임워크**: [Tauri 2.0](https://tauri.app/) (Rust 백엔드 + 웹 프론트엔드)
- **프론트엔드**: React + TypeScript
- **백엔드**: Rust
- **Notion 연동**: MCP (Model Context Protocol) 서버

## 설치 및 실행

### 요구사항
- Node.js 18+
- Rust 1.70+
- macOS 10.15+

### 개발 환경 설정

```bash
# 저장소 클론
git clone https://github.com/yalkongs/AINoteWork.git
cd AINoteWork

# 의존성 설치
npm install

# 개발 서버 실행
npm run tauri dev
```

### 프로덕션 빌드

```bash
npm run tauri build
```

빌드된 앱은 `src-tauri/target/release/bundle/` 디렉토리에 생성됩니다.

## API 키 설정

앱을 사용하려면 다음 API 키가 필요합니다:

| 서비스 | 필수 여부 | 발급 링크 |
|--------|----------|----------|
| Claude (Anthropic) | 필수 (1개 이상) | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | 선택 | [platform.openai.com](https://platform.openai.com/) |
| Google Gemini | 선택 | [aistudio.google.com](https://aistudio.google.com/) |
| Notion | 선택 | [developers.notion.com](https://developers.notion.com/) |

## 프로젝트 구조

```
AINoteWork/
├── src/                    # React 프론트엔드
│   ├── App.tsx            # 메인 컴포넌트
│   ├── App.css            # 스타일
│   └── main.tsx           # 진입점
├── src-tauri/             # Rust 백엔드
│   ├── src/
│   │   ├── lib.rs         # Tauri 앱 설정
│   │   ├── commands.rs    # Tauri 명령어
│   │   ├── claude.rs      # Claude API 클라이언트
│   │   ├── ai_clients.rs  # OpenAI/Gemini 클라이언트
│   │   ├── mcp.rs         # MCP 클라이언트 (Notion)
│   │   └── web.rs         # 웹 스크래핑
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── README.md
```

## 라이선스

Copyright © 2025 황원철. All rights reserved.

## 제작자

**황원철** (WeonCheol Hwang)
