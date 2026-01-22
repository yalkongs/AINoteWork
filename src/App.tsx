import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";

type ActionType = "translate" | "summarize" | "question";
type AiModel = "claude" | "openai" | "gemini";
type ViewMode = "edit" | "view";
type Theme = "dark" | "light";

interface ApiUsageInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

type FileType = "pdf" | "ppt" | "pptx" | "xls" | "xlsx" | "doc" | "docx" | "image" | "text" | null;

interface Source {
  id: string;
  url: string;
  title: string;
  content: string;
  color: string;
  loadedAt: string;
  // File-specific fields
  isFile?: boolean;
  fileType?: FileType;
  filePath?: string;
  fileDataUrl?: string; // Base64 data URL for preview
}

interface NoteSection {
  id: string;
  type: "text" | "question" | "summary" | "translation" | "highlight" | "template";
  content: string;
  sourceId?: string;
  tags: string[];
  timestamp: string;
  aiModel?: string;
  isImportant: boolean;
  templateId?: string;
}

interface NoteVersion {
  id: string;
  noteId: string;
  content: string;
  timestamp: string;
}

interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface Session {
  id: string;
  projectId: string;
  sources: Source[];
  notes: NoteSection[];
  conversationHistory: ConversationEntry[];
  totalCost: number;
  lastActivity: string;
}

interface ConversationEntry {
  id: string;
  question: string;
  answer: string;
  model: string;
  sourceId: string;
  timestamp: string;
}

interface AnalysisTemplate {
  id: string;
  name: string;
  prompt: string;
  icon: string;
}

interface CommandPaletteItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
  category: string;
}

interface PromptPreset {
  id: string;
  name: string;
  prompt: string;
  category: string;
}

const SOURCE_COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"
];

const ANALYSIS_TEMPLATES: AnalysisTemplate[] = [
  { id: "keypoints", name: "요점 정리", prompt: "다음 내용의 핵심 요점을 체계적으로 정리해주세요. 주요 개념, 핵심 주장, 중요한 세부사항을 구조화하여 설명해주세요.", icon: "🎯" },
  { id: "deep_research", name: "Deep Research", prompt: "다음 내용에 대해 깊이 있는 분석을 해주세요. 각 개념과 주제에 대해 상세하게 설명하고, 배경 지식, 맥락, 의미, 그리고 실제 적용 사례까지 포함하여 전문가 수준의 심층 분석을 제공해주세요.", icon: "🔬" },
  { id: "related_topics", name: "연관 주제 추출", prompt: "다음 내용과 관련된 주제들을 추출해주세요. 직접적으로 연관된 개념, 확장하여 학습할 수 있는 주제, 관련 분야, 그리고 더 깊이 탐구할 만한 질문들을 제시해주세요.", icon: "🔗" },
];

const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  { id: "explain", name: "쉽게 설명", prompt: "다음 내용을 초보자도 이해할 수 있게 쉽게 설명해주세요.", category: "기본" },
  { id: "example", name: "예시 요청", prompt: "이 개념에 대한 구체적인 예시를 들어주세요.", category: "기본" },
  { id: "compare", name: "비교 분석", prompt: "다음 내용의 장단점을 비교 분석해주세요.", category: "분석" },
  { id: "practical", name: "실용적 적용", prompt: "이 내용을 실제로 어떻게 적용할 수 있는지 알려주세요.", category: "활용" },
  { id: "critique", name: "비판적 분석", prompt: "이 내용에 대해 비판적인 관점에서 분석해주세요. 잠재적 문제점이나 한계를 지적해주세요.", category: "분석" },
];

function App() {
  // API Keys
  const [apiKeySet, setApiKeySet] = useState(false);
  const [openaiKeySet, setOpenaiKeySet] = useState(false);
  const [geminiKeySet, setGeminiKeySet] = useState(false);
  const [notionTokenSet, setNotionTokenSet] = useState(false);
  const [mcpConnected, setMcpConnected] = useState(false);
  const [mcpConnecting, setMcpConnecting] = useState(false);

  // Settings inputs
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [notionTokenInput, setNotionTokenInput] = useState("");

  // Sources (multi-source support)
  const [sources, setSources] = useState<Source[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);

  // Notes
  const [notes, setNotes] = useState<NoteSection[]>([]);
  const [noteViewMode, setNoteViewMode] = useState<ViewMode>("view");
  const [rawNoteText, setRawNoteText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [noteVersions, setNoteVersions] = useState<NoteVersion[]>([]);

  // Question & AI
  const [question, setQuestion] = useState("");
  const [selectedAiModel, setSelectedAiModel] = useState<AiModel>("claude");
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [lastConversationId, setLastConversationId] = useState<string | null>(null);

  // Templates
  // showTemplates state removed - templates are now individual buttons

  // Prompt Presets
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>(DEFAULT_PROMPT_PRESETS);
  const [showPromptPresets, setShowPromptPresets] = useState(false);

  // Projects & Sessions
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [lastApiUsage, setLastApiUsage] = useState<ApiUsageInfo | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const [showUrlHistory, setShowUrlHistory] = useState(false);

  // Selection state
  const [selectedText, setSelectedText] = useState("");

  // Source panel edit mode
  const [sourceEditMode, setSourceEditMode] = useState(false);

  // Selected text from notes panel for Ask
  const [selectedNoteText, setSelectedNoteText] = useState("");

  // Theme
  const [theme, setTheme] = useState<Theme>("dark");

  // Focus Mode
  const [focusMode, setFocusMode] = useState(false);

  // Command Palette
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");

  // Quick Action Popup for source text selection
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [quickActionPosition, setQuickActionPosition] = useState({ x: 0, y: 0 });

  // Clipboard monitoring
  const [clipboardMonitoring, setClipboardMonitoring] = useState(false);
  const [lastClipboardContent, setLastClipboardContent] = useState("");

  // Unified search
  const [showUnifiedSearch, setShowUnifiedSearch] = useState(false);
  const [unifiedSearchQuery, setUnifiedSearchQuery] = useState("");

  // Multi-model comparison
  const [showModelComparison, setShowModelComparison] = useState(false);
  const [comparisonResults, setComparisonResults] = useState<Record<string, string>>({});
  const [comparisonLoading, setComparisonLoading] = useState<Record<string, boolean>>({});

  // Export format
  const [exportFormat, setExportFormat] = useState<"md" | "txt" | "html" | "json">("md");

  // Drag state for source to notes
  const [draggedText, setDraggedText] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Version history modal
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [selectedNoteForHistory, setSelectedNoteForHistory] = useState<string | null>(null);

  // Advanced filter
  const [filterType, setFilterType] = useState<string>("all");
  const [filterDateRange, setFilterDateRange] = useState<string>("all");
  const [filterImportant, setFilterImportant] = useState(false);

  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Refs
  const notesEndRef = useRef<HTMLDivElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const unifiedSearchInputRef = useRef<HTMLInputElement>(null);

  // Generate unique ID
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ainw_theme", theme);
  }, [theme]);

  // Initialize app
  useEffect(() => {
    initializeApp();
    loadSession();

    // Load saved theme
    const savedTheme = localStorage.getItem("ainw_theme") as Theme;
    if (savedTheme) setTheme(savedTheme);

    // Check if first launch (onboarding)
    const onboardingComplete = localStorage.getItem("ainw_onboarding_complete");
    if (!onboardingComplete) {
      setShowOnboarding(true);
    }

    // Auto-save every 30 seconds
    const autoSaveInterval = setInterval(() => {
      saveSession();
    }, 30000);

    // Save on window close
    const handleBeforeUnload = () => {
      saveSession();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(autoSaveInterval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // Clipboard monitoring
  useEffect(() => {
    if (!clipboardMonitoring) return;

    const checkClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== lastClipboardContent && text.length > 10) {
          setLastClipboardContent(text);
          // Show notification or auto-add to sources
        }
      } catch (e) {
        // Clipboard access denied
      }
    };

    const interval = setInterval(checkClipboard, 2000);
    return () => clearInterval(interval);
  }, [clipboardMonitoring, lastClipboardContent]);

  // Command Palette items
  const getCommandPaletteItems = useCallback((): CommandPaletteItem[] => {
    const items: CommandPaletteItem[] = [
      { id: "translate", label: "번역하기", shortcut: "⌘1", action: handleTranslate, category: "AI 작업" },
      { id: "summarize", label: "요약하기", shortcut: "⌘2", action: handleSummarize, category: "AI 작업" },
      { id: "focus-question", label: "질문 입력", shortcut: "⌘3", action: () => questionInputRef.current?.focus(), category: "UI" },
      { id: "toggle-edit", label: "편집 모드 전환", shortcut: "⌘E", action: () => setNoteViewMode(noteViewMode === "edit" ? "view" : "edit"), category: "UI" },
      { id: "save", label: "저장하기", shortcut: "⌘S", action: saveSession, category: "파일" },
      { id: "export", label: "내보내기", action: handleExportNotes, category: "파일" },
      { id: "new-project", label: "새 프로젝트", action: () => setShowProjectModal(true), category: "프로젝트" },
      { id: "toggle-theme", label: theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환", action: () => setTheme(theme === "dark" ? "light" : "dark"), category: "UI" },
      { id: "toggle-focus", label: focusMode ? "포커스 모드 해제" : "포커스 모드", action: () => setFocusMode(!focusMode), category: "UI" },
      { id: "unified-search", label: "통합 검색", shortcut: "⌘/", action: () => setShowUnifiedSearch(true), category: "검색" },
      { id: "compare-models", label: "멀티모델 비교", action: () => setShowModelComparison(true), category: "AI 작업" },
      { id: "clear-notes", label: "노트 모두 지우기", action: clearNotes, category: "노트" },
      { id: "settings", label: "설정 열기", action: () => setShowSettings(!showSettings), category: "UI" },
      { id: "clipboard-monitor", label: clipboardMonitoring ? "클립보드 모니터링 해제" : "클립보드 모니터링 시작", action: () => setClipboardMonitoring(!clipboardMonitoring), category: "입력" },
    ];

    // Add template items
    ANALYSIS_TEMPLATES.forEach(template => {
      items.push({
        id: `template-${template.id}`,
        label: `${template.icon} ${template.name}`,
        action: () => handleTemplateAnalysis(template),
        category: "템플릿"
      });
    });

    // Add prompt presets
    promptPresets.forEach(preset => {
      items.push({
        id: `preset-${preset.id}`,
        label: `💬 ${preset.name}`,
        action: () => {
          setQuestion(preset.prompt);
          setShowCommandPalette(false);
          questionInputRef.current?.focus();
        },
        category: "프롬프트 프리셋"
      });
    });

    return items;
  }, [noteViewMode, theme, focusMode, clipboardMonitoring, promptPresets]);

  const filteredCommands = useCallback(() => {
    const items = getCommandPaletteItems();
    if (!commandSearch) return items;
    const query = commandSearch.toLowerCase();
    return items.filter(item =>
      item.label.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    );
  }, [commandSearch, getCommandPaletteItems]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(!showCommandPalette);
        setCommandSearch("");
        return;
      }

      // Unified search
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShowUnifiedSearch(!showUnifiedSearch);
        setUnifiedSearchQuery("");
        return;
      }

      // Close modals on escape
      if (e.key === "Escape") {
        if (showCommandPalette) {
          setShowCommandPalette(false);
          return;
        }
        if (showUnifiedSearch) {
          setShowUnifiedSearch(false);
          return;
        }
        if (showModelComparison) {
          setShowModelComparison(false);
          return;
        }
        if (focusMode) {
          setFocusMode(false);
          return;
        }
        if (noteViewMode === "edit") {
          setNoteViewMode("view");
          return;
        }
      }

      // Cmd/Ctrl + shortcuts
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case "1":
            e.preventDefault();
            if (getActiveSource()) handleTranslate();
            break;
          case "2":
            e.preventDefault();
            if (getActiveSource()) handleSummarize();
            break;
          case "3":
            e.preventDefault();
            questionInputRef.current?.focus();
            break;
          case "e":
            e.preventDefault();
            setNoteViewMode(noteViewMode === "edit" ? "view" : "edit");
            break;
          case "s":
            e.preventDefault();
            saveSession();
            break;
          case "Enter":
            if (e.shiftKey && selectedText) {
              e.preventDefault();
              handleQuickQuestion(selectedText);
            }
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [noteViewMode, selectedText, sources, activeSourceId, showCommandPalette, showUnifiedSearch, showModelComparison, focusMode]);

  // Handle text selection for highlights and quick actions
  useEffect(() => {
    const handleSelection = (e: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        const text = selection.toString().trim();
        setSelectedText(text);

        // Show quick action popup for source panel selections
        const target = e.target as HTMLElement;
        if (target.closest(".content-text") || target.closest(".source-textarea")) {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          setQuickActionPosition({ x: rect.left + rect.width / 2, y: rect.top - 10 });
          setShowQuickActions(true);
        }
      } else {
        setShowQuickActions(false);
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".quick-action-popup")) {
        setShowQuickActions(false);
      }
    };

    document.addEventListener("mouseup", handleSelection);
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("mouseup", handleSelection);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  // Focus command input when palette opens
  useEffect(() => {
    if (showCommandPalette && commandInputRef.current) {
      commandInputRef.current.focus();
    }
  }, [showCommandPalette]);

  // Focus unified search input when it opens
  useEffect(() => {
    if (showUnifiedSearch && unifiedSearchInputRef.current) {
      unifiedSearchInputRef.current.focus();
    }
  }, [showUnifiedSearch]);

  async function initializeApp() {
    await loadSavedApiKeys();
    await loadProjects();
    loadUrlHistory();
    loadPromptPresets();
    await autoConnectMcp();
  }

  async function loadSavedApiKeys() {
    try {
      const claudeKey = await invoke<string | null>("load_api_key");
      if (claudeKey) setApiKeySet(true);

      const openaiKey = await invoke<string | null>("load_openai_key");
      if (openaiKey) setOpenaiKeySet(true);

      const geminiKey = await invoke<string | null>("load_gemini_key");
      if (geminiKey) setGeminiKeySet(true);

      const notionToken = await invoke<string | null>("load_notion_token");
      if (notionToken) setNotionTokenSet(true);
    } catch (e) {
      console.error("Failed to load API keys:", e);
    }
  }

  async function autoConnectMcp() {
    try {
      const token = await invoke<string | null>("load_notion_token");
      if (token) {
        setMcpConnecting(true);
        setMcpConnected(false);
        await invoke("connect_mcp", {
          command: "npx",
          args: ["-y", "@notionhq/notion-mcp-server"],
        });
        setMcpConnected(true);
      }
    } catch (e) {
      console.error("Failed to auto-connect MCP:", e);
      setMcpConnected(false);
      // Show error to user for MCP connection failures
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes("timed out")) {
        setError("MCP 연결 시간 초과. Notion 토큰을 확인하거나 네트워크 연결을 확인해주세요.");
      }
    } finally {
      setMcpConnecting(false);
    }
  }

  function loadUrlHistory() {
    try {
      const saved = localStorage.getItem("ainw_url_history");
      if (saved) setUrlHistory(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load URL history:", e);
    }
  }

  function loadPromptPresets() {
    try {
      const saved = localStorage.getItem("ainw_prompt_presets");
      if (saved) setPromptPresets(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load prompt presets:", e);
    }
  }

  function saveUrlToHistory(url: string) {
    if (!url.trim()) return;
    setUrlHistory(prev => {
      const filtered = prev.filter(u => u !== url);
      const updated = [url, ...filtered].slice(0, 20);
      localStorage.setItem("ainw_url_history", JSON.stringify(updated));
      return updated;
    });
  }

  // Session management
  async function loadSession() {
    try {
      const saved = localStorage.getItem("ainw_current_session");
      if (saved) {
        const session: Session = JSON.parse(saved);
        setSources(session.sources || []);
        setNotes(session.notes || []);
        setConversationHistory(session.conversationHistory || []);
        setTotalCost(session.totalCost || 0);
        if (session.sources.length > 0) {
          setActiveSourceId(session.sources[0].id);
        }
        // Convert notes to raw text for edit mode
        setRawNoteText(notesToText(session.notes || []));
      }

      // Load note versions
      const savedVersions = localStorage.getItem("ainw_note_versions");
      if (savedVersions) {
        setNoteVersions(JSON.parse(savedVersions));
      }
    } catch (e) {
      console.error("Failed to load session:", e);
    }
  }

  function saveSession() {
    try {
      const session: Session = {
        id: generateId(),
        projectId: currentProject?.id || "default",
        sources,
        notes,
        conversationHistory,
        totalCost,
        lastActivity: new Date().toISOString(),
      };
      localStorage.setItem("ainw_current_session", JSON.stringify(session));

      // Save note versions
      localStorage.setItem("ainw_note_versions", JSON.stringify(noteVersions));
    } catch (e) {
      console.error("Failed to save session:", e);
    }
  }

  // Project management
  async function loadProjects() {
    try {
      const saved = localStorage.getItem("ainw_projects");
      if (saved) {
        const projectList: Project[] = JSON.parse(saved);
        setProjects(projectList);
        if (projectList.length > 0) {
          setCurrentProject(projectList[0]);
        }
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  }

  function createProject(name: string) {
    const newProject: Project = {
      id: generateId(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [...projects, newProject];
    setProjects(updated);
    setCurrentProject(newProject);
    localStorage.setItem("ainw_projects", JSON.stringify(updated));
    setShowProjectModal(false);
    setNewProjectName("");

    // Clear current session for new project
    setSources([]);
    setNotes([]);
    setConversationHistory([]);
    setTotalCost(0);
    setActiveSourceId(null);
  }

  // Source management
  function getActiveSource(): Source | undefined {
    return sources.find(s => s.id === activeSourceId);
  }

  function isNotionUrl(url: string): boolean {
    return url.includes("notion.so") || url.includes("notion.site");
  }

  async function loadSource(url: string) {
    if (!url.trim()) return;

    setLoadingSource(true);
    setError("");

    try {
      let content: string;
      if (isNotionUrl(url)) {
        if (!mcpConnected) {
          setError("Please connect to Notion MCP first");
          return;
        }
        content = await invoke<string>("fetch_notion_page", { pageUrl: url.trim() });
      } else {
        content = await invoke<string>("fetch_web_page", { url: url.trim() });
      }

      const newSource: Source = {
        id: generateId(),
        url: url.trim(),
        title: extractTitle(content) || url,
        content,
        color: SOURCE_COLORS[sources.length % SOURCE_COLORS.length],
        loadedAt: new Date().toISOString(),
      };

      setSources(prev => [...prev, newSource]);
      setActiveSourceId(newSource.id);
      saveUrlToHistory(url.trim());
      setUrlInput("");
    } catch (e) {
      setError(`Failed to load content: ${e}`);
    } finally {
      setLoadingSource(false);
    }
  }

  function extractTitle(content: string): string {
    const lines = content.split("\n").filter(l => l.trim());
    if (lines.length > 0) {
      return lines[0].replace(/^#+\s*/, "").slice(0, 50);
    }
    return "";
  }

  function removeSource(sourceId: string) {
    setSources(prev => prev.filter(s => s.id !== sourceId));
    if (activeSourceId === sourceId) {
      const remaining = sources.filter(s => s.id !== sourceId);
      setActiveSourceId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  // Update source content (for editing)
  function updateSourceContent(sourceId: string, newContent: string) {
    setSources(prev => prev.map(s =>
      s.id === sourceId ? { ...s, content: newContent } : s
    ));
  }

  // Add new source from pasted/typed content
  function addManualSource(content: string) {
    if (!content.trim()) return;

    const newSource: Source = {
      id: generateId(),
      url: "manual-input",
      title: extractTitle(content) || "Manual Input",
      content: content.trim(),
      color: SOURCE_COLORS[sources.length % SOURCE_COLORS.length],
      loadedAt: new Date().toISOString(),
    };

    setSources(prev => [...prev, newSource]);
    setActiveSourceId(newSource.id);
  }

  // Notes management
  function notesToText(noteList: NoteSection[]): string {
    return noteList.map(n => {
      let prefix = "";
      if (n.type === "question") prefix = "**Q: ";
      if (n.type === "highlight") prefix = "> ";
      const tagStr = n.tags.length > 0 ? ` #${n.tags.join(" #")}` : "";
      const important = n.isImportant ? " ⭐" : "";
      return `${prefix}${n.content}${important}${tagStr}`;
    }).join("\n\n---\n\n");
  }

  function addNote(content: string, type: NoteSection["type"], sourceId?: string, aiModel?: string, templateId?: string) {
    const newNote: NoteSection = {
      id: generateId(),
      type,
      content,
      sourceId,
      tags: [],
      timestamp: new Date().toISOString(),
      aiModel,
      isImportant: false,
      templateId,
    };
    setNotes(prev => {
      const updated = [...prev, newNote];
      setRawNoteText(notesToText(updated));
      return updated;
    });
  }

  function toggleNoteImportant(noteId: string) {
    setNotes(prev => {
      const updated = prev.map(n =>
        n.id === noteId ? { ...n, isImportant: !n.isImportant } : n
      );
      setRawNoteText(notesToText(updated));
      return updated;
    });
  }

  function addTagToNote(noteId: string, tag: string) {
    setNotes(prev => {
      const updated = prev.map(n =>
        n.id === noteId ? { ...n, tags: [...new Set([...n.tags, tag])] } : n
      );
      setRawNoteText(notesToText(updated));
      return updated;
    });
  }

  function deleteNote(noteId: string) {
    setNotes(prev => {
      const updated = prev.filter(n => n.id !== noteId);
      setRawNoteText(notesToText(updated));
      return updated;
    });
  }

  function updateNoteContent(noteId: string, newContent: string) {
    // Save version before updating
    const note = notes.find(n => n.id === noteId);
    if (note) {
      const version: NoteVersion = {
        id: generateId(),
        noteId,
        content: note.content,
        timestamp: new Date().toISOString(),
      };
      setNoteVersions(prev => [...prev, version].slice(-100)); // Keep last 100 versions
    }

    setNotes(prev => {
      const updated = prev.map(n =>
        n.id === noteId ? { ...n, content: newContent } : n
      );
      setRawNoteText(notesToText(updated));
      return updated;
    });
  }

  function restoreNoteVersion(version: NoteVersion) {
    updateNoteContent(version.noteId, version.content);
    setShowVersionHistory(false);
  }

  function clearNotes() {
    setNotes([]);
    setRawNoteText("");
  }

  // Complete onboarding
  function completeOnboarding(goToSettings: boolean = false) {
    localStorage.setItem("ainw_onboarding_complete", "true");
    setShowOnboarding(false);
    setOnboardingStep(0);
    if (goToSettings) {
      setShowSettings(true);
    }
  }

  // Get all unique tags from notes
  function getAllTags(): string[] {
    const tags = new Set<string>();
    notes.forEach(n => n.tags.forEach(t => tags.add(t)));
    return Array.from(tags);
  }

  // Filter notes with advanced options
  function getFilteredNotes(): NoteSection[] {
    let filtered = notes;

    // Type filter
    if (filterType !== "all") {
      filtered = filtered.filter(n => n.type === filterType);
    }

    // Important filter
    if (filterImportant) {
      filtered = filtered.filter(n => n.isImportant);
    }

    // Date range filter
    if (filterDateRange !== "all") {
      const now = new Date();
      let cutoff: Date;
      switch (filterDateRange) {
        case "today":
          cutoff = new Date(now.setHours(0, 0, 0, 0));
          break;
        case "week":
          cutoff = new Date(now.setDate(now.getDate() - 7));
          break;
        case "month":
          cutoff = new Date(now.setMonth(now.getMonth() - 1));
          break;
        default:
          cutoff = new Date(0);
      }
      filtered = filtered.filter(n => new Date(n.timestamp) >= cutoff);
    }

    // Tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter(n =>
        selectedTags.some(t => n.tags.includes(t))
      );
    }

    // Search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(n =>
        n.content.toLowerCase().includes(query)
      );
    }

    return filtered;
  }

  // Unified search - search across sources and notes
  function getUnifiedSearchResults() {
    if (!unifiedSearchQuery.trim()) return { sources: [], notes: [] };

    const query = unifiedSearchQuery.toLowerCase();

    const matchingSources = sources.filter(s =>
      s.content.toLowerCase().includes(query) ||
      s.title.toLowerCase().includes(query)
    );

    const matchingNotes = notes.filter(n =>
      n.content.toLowerCase().includes(query) ||
      n.tags.some(t => t.toLowerCase().includes(query))
    );

    return { sources: matchingSources, notes: matchingNotes };
  }

  // API usage tracking
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
  }

  function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing: Record<string, { input: number; output: number }> = {
      "claude": { input: 3.0, output: 15.0 },
      "openai": { input: 0.15, output: 0.60 },
      "gemini": { input: 0.10, output: 0.40 },
    };
    const price = pricing[model] || { input: 0, output: 0 };
    return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  }

  function updateApiUsage(model: string, inputText: string, outputText: string) {
    const inputTokens = estimateTokens(inputText);
    const outputTokens = estimateTokens(outputText);
    const cost = calculateCost(model, inputTokens, outputTokens);

    const modelNames: Record<string, string> = {
      "claude": "Claude Sonnet 4",
      "openai": "GPT-4o Mini",
      "gemini": "Gemini 2.0 Flash",
    };

    setLastApiUsage({
      model: modelNames[model] || model,
      inputTokens,
      outputTokens,
      cost,
    });

    setTotalCost(prev => prev + cost);
  }

  // Helper: Get content from source (extract text from files if needed)
  async function getSourceContent(source: Source): Promise<string> {
    // If not a file, return content directly
    if (!source.isFile) {
      return source.content;
    }

    // If file already has extracted content, return it
    if (source.content && source.content.trim()) {
      return source.content;
    }

    // Extract text from file
    if (source.fileDataUrl && source.fileType) {
      try {
        const extractedText = await invoke<string>("extract_text_from_file", {
          fileData: source.fileDataUrl,
          fileType: source.fileType,
        });

        // Cache extracted text in source
        setSources(prev => prev.map(s =>
          s.id === source.id ? { ...s, content: extractedText } : s
        ));

        return extractedText;
      } catch (e) {
        throw new Error(`파일에서 텍스트를 추출할 수 없습니다: ${e}`);
      }
    }

    throw new Error("파일 데이터가 없습니다");
  }

  // AI Actions
  async function handleTranslate() {
    const source = getActiveSource();
    if (!source) {
      setError("Please load content first");
      return;
    }

    setLoading(true);
    setError("");
    setActiveAction("translate");

    try {
      const content = await getSourceContent(source);
      const response = await invoke<string>("translate_content", {
        content,
        targetLanguage: "Korean",
      });
      addNote(response, "translation", source.id, "claude");
      updateApiUsage("claude", content, response);
    } catch (e) {
      setError(`Translation failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSummarize() {
    const source = getActiveSource();
    if (!source) {
      setError("Please load content first");
      return;
    }

    setLoading(true);
    setError("");
    setActiveAction("summarize");

    try {
      const content = await getSourceContent(source);
      const response = await invoke<string>("summarize_content", {
        content,
      });
      addNote(response, "summary", source.id, "claude");
      updateApiUsage("claude", content, response);
    } catch (e) {
      setError(`Summarization failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleTemplateAnalysis(template: AnalysisTemplate) {
    // Use SOURCE content for template analysis (not notes)
    const source = sources.find((s) => s.id === activeSourceId);
    if (!source) {
      setError("소스를 먼저 선택하거나 로드해주세요");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const content = await getSourceContent(source);
      if (!content.trim()) {
        setError("소스 내용이 비어있습니다");
        return;
      }

      const fullPrompt = `${template.prompt}\n\n내용:\n${content}`;
      const response = await invoke<string>("ask_claude_content", {
        content,
        question: template.prompt,
      });
      addNote(`## ${template.icon} ${template.name}\n\n${response}`, "template", activeSourceId || undefined, "claude", template.id);
      updateApiUsage("claude", fullPrompt, response);
    } catch (e) {
      setError(`Analysis failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAskQuestion(followUpContext?: string) {
    const currentQuestion = question.trim();
    if (!currentQuestion) {
      setError("질문을 입력해주세요");
      return;
    }

    // Ask uses the LAST note result as context (not all notes or source)
    const sourceNotes = notes.filter(n => n.sourceId === activeSourceId);
    const lastNote = sourceNotes[sourceNotes.length - 1];

    if (!lastNote) {
      setError("먼저 번역, 요약, 또는 템플릿 분석을 실행해주세요");
      return;
    }

    // Check API key
    if (selectedAiModel === "claude" && !apiKeySet) {
      setError("Claude API 키를 설정해주세요");
      return;
    }
    if (selectedAiModel === "openai" && !openaiKeySet) {
      setError("OpenAI API 키를 설정해주세요");
      return;
    }
    if (selectedAiModel === "gemini" && !geminiKeySet) {
      setError("Gemini API 키를 설정해주세요");
      return;
    }

    setLoading(true);
    setError("");
    setActiveAction("question");

    try {
      // Use the last note's content as context
      let contextContent = lastNote.content;
      let fullQuestion = currentQuestion;

      // If there's selected text from notes, include it as focus
      if (selectedNoteText) {
        fullQuestion = `다음 선택된 부분에 대해 질문합니다:\n\n"${selectedNoteText}"\n\n질문: ${currentQuestion}`;
      }

      // Add follow-up context if available
      if (followUpContext && lastConversationId) {
        const lastConv = conversationHistory.find(c => c.id === lastConversationId);
        if (lastConv) {
          contextContent = `이전 질문: ${lastConv.question}\n이전 답변: ${lastConv.answer}\n\n참조 내용:\n${lastNote.content}`;
        }
      }

      let response: string;
      const modelLabel = selectedAiModel === "claude" ? "Claude" : selectedAiModel === "openai" ? "GPT" : "Gemini";

      if (selectedAiModel === "openai") {
        response = await invoke<string>("ask_openai_content", {
          content: contextContent,
          question: fullQuestion,
        });
      } else if (selectedAiModel === "gemini") {
        response = await invoke<string>("ask_gemini_content", {
          content: contextContent,
          question: fullQuestion,
        });
      } else {
        response = await invoke<string>("ask_claude_content", {
          content: contextContent,
          question: fullQuestion,
        });
      }

      // Add to conversation history
      const convEntry: ConversationEntry = {
        id: generateId(),
        question: currentQuestion,
        answer: response,
        model: modelLabel,
        sourceId: activeSourceId || "",
        timestamp: new Date().toISOString(),
      };
      setConversationHistory(prev => [...prev, convEntry]);
      setLastConversationId(convEntry.id);
      setShowFollowUp(true);

      // Add to notes
      const questionDisplay = selectedNoteText
        ? `**Q: ${currentQuestion}** *(${modelLabel})*\n> 선택: "${selectedNoteText.slice(0, 100)}${selectedNoteText.length > 100 ? '...' : ''}"\n\n${response}`
        : `**Q: ${currentQuestion}** *(${modelLabel})*\n\n${response}`;
      addNote(questionDisplay, "question", activeSourceId || undefined, selectedAiModel);
      updateApiUsage(selectedAiModel, contextContent + fullQuestion, response);
      setQuestion("");
      setSelectedNoteText(""); // Clear selected text after asking
    } catch (e) {
      setError(`Question failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickQuestion(text: string) {
    const source = getActiveSource();
    if (!source || !apiKeySet) return;

    setLoading(true);
    try {
      const response = await invoke<string>("ask_claude_content", {
        content: source.content,
        question: `다음 부분에 대해 자세히 설명해주세요: "${text}"`,
      });
      addNote(`**선택 텍스트:** "${text}"\n\n${response}`, "question", source.id, "claude");
      updateApiUsage("claude", source.content + text, response);
    } catch (e) {
      setError(`Quick question failed: ${e}`);
    } finally {
      setLoading(false);
      setSelectedText("");
      setShowQuickActions(false);
    }
  }

  // Multi-model comparison
  async function handleMultiModelComparison() {
    const notesContent = rawNoteText.trim();
    if (!notesContent || !question.trim()) {
      setError("Please add notes and enter a question");
      return;
    }

    setComparisonLoading({ claude: true, openai: true, gemini: true });
    setComparisonResults({});

    const models: AiModel[] = [];
    if (apiKeySet) models.push("claude");
    if (openaiKeySet) models.push("openai");
    if (geminiKeySet) models.push("gemini");

    for (const model of models) {
      try {
        let response: string;
        if (model === "openai") {
          response = await invoke<string>("ask_openai_content", {
            content: notesContent,
            question: question.trim(),
          });
        } else if (model === "gemini") {
          response = await invoke<string>("ask_gemini_content", {
            content: notesContent,
            question: question.trim(),
          });
        } else {
          response = await invoke<string>("ask_claude_content", {
            content: notesContent,
            question: question.trim(),
          });
        }
        setComparisonResults(prev => ({ ...prev, [model]: response }));
        updateApiUsage(model, notesContent + question, response);
      } catch (e) {
        setComparisonResults(prev => ({ ...prev, [model]: `Error: ${e}` }));
      } finally {
        setComparisonLoading(prev => ({ ...prev, [model]: false }));
      }
    }
  }

  // Follow-up questions
  const followUpQuestions = [
    "더 자세히 설명해줘",
    "예시를 들어줘",
    "실제 적용 방법은?",
    "관련 개념은?",
  ];

  async function handleFollowUp(followUpText: string) {
    setQuestion(followUpText);
    await handleAskQuestion("follow-up");
  }

  // Highlight
  function addHighlight() {
    if (!selectedText || !activeSourceId) return;
    addNote(selectedText, "highlight", activeSourceId);
    setSelectedText("");
    setShowQuickActions(false);
  }

  // Add text to notes (from source)
  function addTextToNotes(text: string) {
    addNote(text, "text", activeSourceId || undefined);
    setShowQuickActions(false);
  }

  // Export with multiple formats
  async function handleExportNotes() {
    if (notes.length === 0) {
      setError("No notes to export");
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
      const extension = exportFormat;
      const filePath = await save({
        filters: [
          { name: extension.toUpperCase(), extensions: [extension] },
        ],
        defaultPath: `notes_${timestamp}.${extension}`,
      });

      if (filePath) {
        let exportContent: string;

        switch (exportFormat) {
          case "html":
            exportContent = generateHtmlExport();
            break;
          case "json":
            exportContent = JSON.stringify({
              project: currentProject?.name || "Default",
              exportDate: new Date().toISOString(),
              sources: sources.map(s => ({ title: s.title, url: s.url })),
              notes: notes,
              totalCost
            }, null, 2);
            break;
          case "txt":
            exportContent = generateTextExport();
            break;
          default: // md
            exportContent = generateMarkdownExport();
        }

        await invoke("export_notes_to_file", { filePath, content: exportContent });
        setError("");
      }
    } catch (e) {
      setError(`Failed to export: ${e}`);
    }
  }

  function generateMarkdownExport(): string {
    let content = `# AI Note Work - Export\n\n`;
    content += `**Project:** ${currentProject?.name || "Default"}\n`;
    content += `**Date:** ${new Date().toLocaleString()}\n\n`;
    content += `---\n\n`;

    if (sources.length > 0) {
      content += `## Sources\n\n`;
      sources.forEach(s => {
        content += `- [${s.title}](${s.url})\n`;
      });
      content += `\n---\n\n`;
    }

    content += `## Notes\n\n`;
    content += notesToText(notes);
    content += `\n\n---\n\n`;
    content += `**Total API Cost:** $${totalCost.toFixed(4)}\n`;

    return content;
  }

  function generateTextExport(): string {
    let content = `AI Note Work - Export\n`;
    content += `=`.repeat(50) + `\n\n`;
    content += `Project: ${currentProject?.name || "Default"}\n`;
    content += `Date: ${new Date().toLocaleString()}\n\n`;
    content += `-`.repeat(50) + `\n\n`;

    if (sources.length > 0) {
      content += `Sources:\n`;
      sources.forEach(s => {
        content += `  - ${s.title}: ${s.url}\n`;
      });
      content += `\n` + `-`.repeat(50) + `\n\n`;
    }

    content += `Notes:\n\n`;
    notes.forEach(n => {
      content += `[${n.type.toUpperCase()}] ${n.timestamp}\n`;
      content += n.content + `\n`;
      if (n.tags.length > 0) {
        content += `Tags: ${n.tags.join(", ")}\n`;
      }
      content += `\n`;
    });

    content += `-`.repeat(50) + `\n`;
    content += `Total API Cost: $${totalCost.toFixed(4)}\n`;

    return content;
  }

  function generateHtmlExport(): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Note Work Export - ${currentProject?.name || "Default"}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: #f5f5f5; }
    h1 { color: #4f46e5; }
    .note { background: white; padding: 1rem; margin: 1rem 0; border-radius: 8px; border-left: 4px solid #4f46e5; }
    .note.question { border-left-color: #10b981; }
    .note.summary { border-left-color: #8b5cf6; }
    .note.translation { border-left-color: #3b82f6; }
    .note.highlight { border-left-color: #fbbf24; background: #fef3c7; }
    .tag { background: #4f46e5; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; margin-right: 4px; }
    .meta { color: #666; font-size: 0.85rem; margin-top: 0.5rem; }
    .sources { background: white; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; }
    .sources a { color: #4f46e5; }
  </style>
</head>
<body>
  <h1>AI Note Work Export</h1>
  <p><strong>Project:</strong> ${currentProject?.name || "Default"}</p>
  <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>

  ${sources.length > 0 ? `
  <div class="sources">
    <h2>Sources</h2>
    <ul>
      ${sources.map(s => `<li><a href="${s.url}">${s.title}</a></li>`).join('\n      ')}
    </ul>
  </div>
  ` : ''}

  <h2>Notes</h2>
  ${notes.map(n => `
  <div class="note ${n.type}">
    <div>${n.content.replace(/\n/g, '<br>')}</div>
    ${n.tags.length > 0 ? `<div class="meta">${n.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>` : ''}
    <div class="meta">${new Date(n.timestamp).toLocaleString()} ${n.aiModel ? `| ${n.aiModel}` : ''}</div>
  </div>
  `).join('\n')}

  <p class="meta"><strong>Total API Cost:</strong> $${totalCost.toFixed(4)}</p>
</body>
</html>`;
  }

  // Compare sources
  async function handleCompareSources() {
    if (sources.length < 2) {
      setError("Need at least 2 sources to compare");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const sourceContents = sources.map((s, i) =>
        `[문서 ${i + 1}: ${s.title}]\n${s.content.slice(0, 2000)}...`
      ).join("\n\n---\n\n");

      const response = await invoke<string>("ask_claude_content", {
        content: sourceContents,
        question: "위 문서들을 비교 분석해주세요. 공통점, 차이점, 그리고 각 문서의 핵심 주장을 정리해주세요.",
      });

      addNote(`## 📊 문서 비교 분석\n\n${response}`, "summary", undefined, "claude");
      updateApiUsage("claude", sourceContents, response);
    } catch (e) {
      setError(`Comparison failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  // API Key handlers
  async function handleSetApiKey(type: "claude" | "openai" | "gemini" | "notion") {
    try {
      if (type === "claude" && apiKeyInput.trim()) {
        await invoke("set_api_key", { apiKey: apiKeyInput.trim() });
        setApiKeySet(true);
        setApiKeyInput("");
      } else if (type === "openai" && openaiKeyInput.trim()) {
        await invoke("set_openai_key", { apiKey: openaiKeyInput.trim() });
        setOpenaiKeySet(true);
        setOpenaiKeyInput("");
      } else if (type === "gemini" && geminiKeyInput.trim()) {
        await invoke("set_gemini_key", { apiKey: geminiKeyInput.trim() });
        setGeminiKeySet(true);
        setGeminiKeyInput("");
      } else if (type === "notion" && notionTokenInput.trim()) {
        await invoke("set_notion_token", { token: notionTokenInput.trim() });
        setNotionTokenSet(true);
        setNotionTokenInput("");
        await autoConnectMcp();
      }
    } catch (e) {
      setError(`Failed to set ${type} key: ${e}`);
    }
  }

  async function handleClearApiKey(type: "claude" | "openai" | "gemini") {
    try {
      if (type === "claude") {
        await invoke("clear_api_key");
        setApiKeySet(false);
      } else if (type === "openai") {
        await invoke("clear_openai_key");
        setOpenaiKeySet(false);
      } else if (type === "gemini") {
        await invoke("clear_gemini_key");
        setGeminiKeySet(false);
      }
    } catch (e) {
      setError(`Failed to clear ${type} key: ${e}`);
    }
  }

  // Drag and drop handlers
  function handleDragStart(e: React.DragEvent, text: string) {
    setDraggedText(text);
    setIsDragging(true);
    e.dataTransfer.setData("text/plain", text);
  }

  function handleDragEnd() {
    setDraggedText("");
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const text = e.dataTransfer.getData("text/plain") || draggedText;
    if (text) {
      addNote(text, "text", activeSourceId || undefined);
    }
    setIsDragging(false);
    setDraggedText("");
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  // Helper to determine file type from extension
  function getFileType(fileName: string): FileType {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    const typeMap: Record<string, FileType> = {
      'pdf': 'pdf',
      'ppt': 'ppt',
      'pptx': 'pptx',
      'xls': 'xls',
      'xlsx': 'xlsx',
      'doc': 'doc',
      'docx': 'docx',
      'png': 'image',
      'jpg': 'image',
      'jpeg': 'image',
      'gif': 'image',
      'webp': 'image',
      'txt': 'text',
      'md': 'text',
    };
    return typeMap[ext] || null;
  }

  // Supported file extensions for preview
  const SUPPORTED_FILE_EXTENSIONS = [
    '.pdf', '.ppt', '.pptx', '.xls', '.xlsx', '.doc', '.docx',
    '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.txt', '.md'
  ];

  // Add file source with preview (no text extraction for binary files)
  async function addFileSource(file: File) {
    const fileType = getFileType(file.name);

    if (fileType === 'text') {
      // For text files, read content as before
      const text = await file.text();
      addManualSource(text);
      return;
    }

    // For binary files (PDF, PPT, XLS, etc.), create data URL for preview
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const newSource: Source = {
        id: generateId(),
        url: `file://${file.name}`,
        title: file.name,
        content: '', // No text extraction - preview only
        color: SOURCE_COLORS[sources.length % SOURCE_COLORS.length],
        loadedAt: new Date().toISOString(),
        isFile: true,
        fileType,
        filePath: file.name,
        fileDataUrl: dataUrl,
      };
      setSources(prev => [...prev, newSource]);
      setActiveSourceId(newSource.id);
    };
    reader.readAsDataURL(file);
  }

  // File drop handler
  async function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');

      if (SUPPORTED_FILE_EXTENSIONS.includes(ext)) {
        await addFileSource(file);
      } else {
        setError(`지원하지 않는 파일 형식입니다: ${file.name}`);
      }
    }
  }

  // Combined drag over handler for file drops
  function handleFileDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  const canPerformAction = apiKeySet && sources.length > 0 && activeSourceId;
  const canAsk = apiKeySet && rawNoteText.trim().length > 0;

  return (
    <main className={`app-container ${focusMode ? "focus-mode" : ""}`}>
      {/* Onboarding Modal */}
      {showOnboarding && (
        <div className="modal-overlay onboarding-overlay">
          <div className="onboarding-modal">
            {onboardingStep === 0 && (
              <div className="onboarding-step">
                <div className="onboarding-logo">
                  <span className="app-logo-icon">AI</span>
                </div>
                <h1 className="onboarding-title">AI Note Work에 오신 것을 환영합니다!</h1>
                <p className="onboarding-subtitle">AI 기반 지능형 노트 & 문서 분석 도구</p>

                <div className="onboarding-creator">
                  <span className="creator-label">Created by</span>
                  <span className="creator-name">황원철</span>
                </div>

                <p className="onboarding-description">
                  AI Note Work는 Notion 페이지나 텍스트 콘텐츠를 AI로 분석하여
                  번역, 요약, 질문응답 기능을 제공하는 데스크톱 앱입니다.
                </p>

                <button
                  className="onboarding-btn primary"
                  onClick={() => setOnboardingStep(1)}
                >
                  다음으로
                </button>
              </div>
            )}

            {onboardingStep === 1 && (
              <div className="onboarding-step">
                <h2 className="onboarding-step-title">주요 기능</h2>

                <div className="onboarding-features">
                  <div className="onboarding-feature">
                    <span className="feature-icon">🔗</span>
                    <div className="feature-info">
                      <h3>Notion 연동</h3>
                      <p>Notion 페이지 URL을 입력하면 자동으로 콘텐츠를 가져옵니다.</p>
                    </div>
                  </div>

                  <div className="onboarding-feature">
                    <span className="feature-icon">🤖</span>
                    <div className="feature-info">
                      <h3>멀티 AI 모델</h3>
                      <p>Claude, GPT-4o, Gemini 중 원하는 AI 모델을 선택하세요.</p>
                    </div>
                  </div>

                  <div className="onboarding-feature">
                    <span className="feature-icon">🌐</span>
                    <div className="feature-info">
                      <h3>번역</h3>
                      <p>다양한 언어로 콘텐츠를 번역합니다.</p>
                    </div>
                  </div>

                  <div className="onboarding-feature">
                    <span className="feature-icon">📝</span>
                    <div className="feature-info">
                      <h3>요약 & 분석</h3>
                      <p>긴 문서를 핵심만 추출하여 요약합니다.</p>
                    </div>
                  </div>

                  <div className="onboarding-feature">
                    <span className="feature-icon">❓</span>
                    <div className="feature-info">
                      <h3>Q&A</h3>
                      <p>문서 내용에 대해 자유롭게 질문하고 답변을 받으세요.</p>
                    </div>
                  </div>

                  <div className="onboarding-feature">
                    <span className="feature-icon">📋</span>
                    <div className="feature-info">
                      <h3>스마트 노트</h3>
                      <p>분석 결과를 노트로 저장하고 관리하세요.</p>
                    </div>
                  </div>
                </div>

                <div className="onboarding-nav">
                  <button
                    className="onboarding-btn secondary"
                    onClick={() => setOnboardingStep(0)}
                  >
                    이전
                  </button>
                  <button
                    className="onboarding-btn primary"
                    onClick={() => setOnboardingStep(2)}
                  >
                    다음으로
                  </button>
                </div>
              </div>
            )}

            {onboardingStep === 2 && (
              <div className="onboarding-step">
                <h2 className="onboarding-step-title">시작하기 전에</h2>

                <div className="onboarding-setup-info">
                  <div className="setup-notice">
                    <span className="notice-icon">⚠️</span>
                    <p>
                      AI Note Work를 사용하려면 <strong>AI API 키</strong>가 필요합니다.
                      최소한 하나의 API 키를 설정해야 앱을 사용할 수 있습니다.
                    </p>
                  </div>

                  <div className="api-requirements">
                    <h4>지원하는 AI 서비스</h4>
                    <ul>
                      <li>
                        <strong>Claude (Anthropic)</strong> -
                        <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">
                          API 키 발급받기 ↗
                        </a>
                      </li>
                      <li>
                        <strong>GPT-4o (OpenAI)</strong> -
                        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                          API 키 발급받기 ↗
                        </a>
                      </li>
                      <li>
                        <strong>Gemini (Google)</strong> -
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
                          API 키 발급받기 ↗
                        </a>
                      </li>
                    </ul>
                  </div>

                  <div className="notion-info">
                    <h4>Notion 연동 (선택)</h4>
                    <p>Notion 페이지를 불러오려면 Notion Integration Token이 필요합니다.</p>
                  </div>
                </div>

                <div className="onboarding-final-actions">
                  <button
                    className="onboarding-btn secondary"
                    onClick={() => setOnboardingStep(1)}
                  >
                    이전
                  </button>
                  <button
                    className="onboarding-btn primary"
                    onClick={() => completeOnboarding(true)}
                  >
                    설정으로 이동
                  </button>
                  <button
                    className="onboarding-btn text"
                    onClick={() => completeOnboarding(false)}
                  >
                    나중에 설정하기
                  </button>
                </div>
              </div>
            )}

            <div className="onboarding-progress">
              {[0, 1, 2].map(step => (
                <span
                  key={step}
                  className={`progress-dot ${onboardingStep === step ? "active" : ""} ${onboardingStep > step ? "completed" : ""}`}
                  onClick={() => setOnboardingStep(step)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Command Palette */}
      {showCommandPalette && (
        <div className="command-palette-overlay" onClick={() => setShowCommandPalette(false)}>
          <div className="command-palette" onClick={e => e.stopPropagation()}>
            <input
              ref={commandInputRef}
              type="text"
              value={commandSearch}
              onChange={e => setCommandSearch(e.target.value)}
              placeholder="명령어 검색..."
              className="command-input"
              onKeyDown={e => {
                if (e.key === "Enter" && filteredCommands().length > 0) {
                  filteredCommands()[0].action();
                  setShowCommandPalette(false);
                }
                if (e.key === "Escape") {
                  setShowCommandPalette(false);
                }
              }}
            />
            <div className="command-list">
              {Object.entries(
                filteredCommands().reduce((acc, item) => {
                  if (!acc[item.category]) acc[item.category] = [];
                  acc[item.category].push(item);
                  return acc;
                }, {} as Record<string, CommandPaletteItem[]>)
              ).map(([category, items]) => (
                <div key={category} className="command-category">
                  <div className="command-category-label">{category}</div>
                  {items.map(item => (
                    <button
                      key={item.id}
                      className="command-item"
                      onClick={() => {
                        item.action();
                        setShowCommandPalette(false);
                      }}
                    >
                      <span className="command-label">{item.label}</span>
                      {item.shortcut && <span className="command-shortcut">{item.shortcut}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Unified Search Modal */}
      {showUnifiedSearch && (
        <div className="modal-overlay" onClick={() => setShowUnifiedSearch(false)}>
          <div className="unified-search-modal" onClick={e => e.stopPropagation()}>
            <input
              ref={unifiedSearchInputRef}
              type="text"
              value={unifiedSearchQuery}
              onChange={e => setUnifiedSearchQuery(e.target.value)}
              placeholder="소스와 노트에서 검색..."
              className="unified-search-input"
            />
            <div className="unified-search-results">
              {unifiedSearchQuery && (
                <>
                  <div className="search-section">
                    <h4>소스 ({getUnifiedSearchResults().sources.length})</h4>
                    {getUnifiedSearchResults().sources.map(s => (
                      <div
                        key={s.id}
                        className="search-result-item"
                        onClick={() => {
                          setActiveSourceId(s.id);
                          setShowUnifiedSearch(false);
                        }}
                      >
                        <span className="source-indicator" style={{ backgroundColor: s.color }} />
                        <span>{s.title}</span>
                      </div>
                    ))}
                  </div>
                  <div className="search-section">
                    <h4>노트 ({getUnifiedSearchResults().notes.length})</h4>
                    {getUnifiedSearchResults().notes.map(n => (
                      <div key={n.id} className="search-result-item">
                        <span className="note-type-icon">
                          {n.type === "question" && "❓"}
                          {n.type === "summary" && "📝"}
                          {n.type === "translation" && "🌐"}
                          {n.type === "highlight" && "📌"}
                          {n.type === "text" && "✏️"}
                        </span>
                        <span>{n.content.slice(0, 100)}...</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Multi-model Comparison Modal */}
      {showModelComparison && (
        <div className="modal-overlay" onClick={() => setShowModelComparison(false)}>
          <div className="model-comparison-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>멀티모델 비교</h3>
              <button className="close-button" onClick={() => setShowModelComparison(false)}>×</button>
            </div>
            <div className="comparison-question">
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="비교할 질문을 입력하세요..."
                className="comparison-input"
              />
              <button
                className="small-button"
                onClick={handleMultiModelComparison}
                disabled={!question.trim() || Object.values(comparisonLoading).some(v => v)}
              >
                비교 시작
              </button>
            </div>
            <div className="comparison-results">
              {["claude", "openai", "gemini"].map(model => {
                const isAvailable = model === "claude" ? apiKeySet : model === "openai" ? openaiKeySet : geminiKeySet;
                if (!isAvailable) return null;
                return (
                  <div key={model} className="comparison-column">
                    <h4>
                      {model === "claude" ? "Claude" : model === "openai" ? "GPT-4o" : "Gemini"}
                    </h4>
                    {comparisonLoading[model] ? (
                      <div className="comparison-loading">
                        <span className="loading-spinner"></span>
                        <span>응답 생성 중...</span>
                      </div>
                    ) : comparisonResults[model] ? (
                      <div className="comparison-content">
                        <ReactMarkdown>{comparisonResults[model]}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="comparison-empty">비교 시작을 클릭하세요</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showVersionHistory && selectedNoteForHistory && (
        <div className="modal-overlay" onClick={() => setShowVersionHistory(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>버전 히스토리</h3>
              <button className="close-button" onClick={() => setShowVersionHistory(false)}>×</button>
            </div>
            <div className="modal-body">
              {noteVersions
                .filter(v => v.noteId === selectedNoteForHistory)
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .map(version => (
                  <div key={version.id} className="version-item">
                    <div className="version-timestamp">
                      {new Date(version.timestamp).toLocaleString()}
                    </div>
                    <div className="version-content">
                      {version.content.slice(0, 200)}...
                    </div>
                    <button
                      className="small-button secondary"
                      onClick={() => restoreNoteVersion(version)}
                    >
                      복원
                    </button>
                  </div>
                ))}
              {noteVersions.filter(v => v.noteId === selectedNoteForHistory).length === 0 && (
                <div className="placeholder">버전 히스토리가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Action Popup */}
      {showQuickActions && selectedText && (
        <div
          className="quick-action-popup"
          style={{ left: quickActionPosition.x, top: quickActionPosition.y }}
        >
          <button onClick={addHighlight}>📌 인용</button>
          <button onClick={() => addTextToNotes(selectedText)}>📝 노트에 추가</button>
          <button onClick={() => handleQuickQuestion(selectedText)}>❓ 질문하기</button>
        </div>
      )}

      {/* Header */}
      {!focusMode && (
        <header className="app-header">
          <div className="header-left">
            <h1>AI Note Work</h1>
            {currentProject && (
              <span className="current-project" onClick={() => setShowProjectModal(true)}>
                📁 {currentProject.name}
              </span>
            )}
          </div>
          <div className="header-right">
            <div className="header-actions">
              <button
                className="icon-button"
                onClick={() => setShowCommandPalette(true)}
                title="명령 팔레트 (⌘K)"
              >
                ⌘K
              </button>
              <button
                className="icon-button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                title={theme === "dark" ? "라이트 모드" : "다크 모드"}
              >
                {theme === "dark" ? "☀️" : "🌙"}
              </button>
              <button
                className="icon-button"
                onClick={() => setFocusMode(true)}
                title="포커스 모드"
              >
                🎯
              </button>
            </div>
            <div className="keyboard-hints">
              <span>⌘1 번역</span>
              <span>⌘2 요약</span>
              <span>⌘3 질문</span>
              <span>⌘K 명령</span>
            </div>
          </div>
        </header>
      )}

      {/* Focus Mode Header */}
      {focusMode && (
        <header className="focus-mode-header">
          <button className="exit-focus-btn" onClick={() => setFocusMode(false)}>
            ← 포커스 모드 종료
          </button>
        </header>
      )}

      {/* URL Bar with Multi-source */}
      {!focusMode && (
        <div
          className="url-bar-section"
          onDrop={handleFileDrop}
          onDragOver={handleFileDragOver}
        >
          <div className="url-bar">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => urlHistory.length > 0 && setShowUrlHistory(true)}
              onBlur={() => setTimeout(() => setShowUrlHistory(false), 200)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadSource(urlInput);
                if (e.key === "Escape") setShowUrlHistory(false);
              }}
              placeholder="Enter URL, paste content, or drop files..."
              className="url-input"
            />
            <button
              className="small-button"
              onClick={() => loadSource(urlInput)}
              disabled={loadingSource || !urlInput.trim()}
            >
              {loadingSource ? "Loading..." : "Add Source"}
            </button>
            {clipboardMonitoring && (
              <span className="clipboard-indicator" title="클립보드 모니터링 중">📋</span>
            )}
          </div>

          {/* Source tabs */}
          {sources.length > 0 && (
            <div className="source-tabs">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className={`source-tab ${activeSourceId === source.id ? "active" : ""}`}
                  style={{ borderColor: source.color }}
                  onClick={() => setActiveSourceId(source.id)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, source.content.slice(0, 500))}
                  onDragEnd={handleDragEnd}
                >
                  <span className="source-color" style={{ backgroundColor: source.color }} />
                  <span className="source-title">{source.title.slice(0, 30)}{source.title.length > 30 ? "..." : ""}</span>
                  <button
                    className="source-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSource(source.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {sources.length >= 2 && (
                <button
                  className="small-button secondary compare-btn"
                  onClick={handleCompareSources}
                  disabled={loading}
                >
                  🔀 비교 분석
                </button>
              )}
            </div>
          )}

          {/* URL History Dropdown */}
          {showUrlHistory && urlHistory.length > 0 && (
            <div className="url-history-dropdown">
              <div className="url-history-header">
                <span>Recent URLs</span>
              </div>
              <ul className="url-history-list">
                {urlHistory.slice(0, 10).map((url, idx) => (
                  <li
                    key={idx}
                    className="url-history-item"
                    onMouseDown={() => {
                      setUrlInput(url);
                      loadSource(url);
                    }}
                  >
                    {url.includes("notion") ? "📝" : "🌐"} {url.slice(0, 60)}{url.length > 60 ? "..." : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="main-content">
        {/* Left Panel - Source Content */}
        {!focusMode && (
          <div className="panel left-panel">
            <div className="panel-header">
              <h2>
                {getActiveSource() ? (
                  <>
                    <span className="source-indicator" style={{ backgroundColor: getActiveSource()?.color }} />
                    {getActiveSource()?.title.slice(0, 40)}
                  </>
                ) : "Source Content"}
              </h2>
              <div className="panel-actions">
                {/* Hide Edit button for file sources (non-editable) */}
                {!getActiveSource()?.isFile && (
                  <button
                    className={`small-button mode-toggle ${sourceEditMode ? "active" : "secondary"}`}
                    onClick={() => setSourceEditMode(!sourceEditMode)}
                  >
                    {sourceEditMode ? "View" : "Edit"}
                  </button>
                )}
                {/* Show file type badge for file sources */}
                {getActiveSource()?.isFile && (
                  <span className="file-type-badge">
                    {getActiveSource()?.fileType?.toUpperCase()} 파일
                  </span>
                )}
              </div>
            </div>
            <div className="panel-content" ref={contentRef}>
              {/* File Preview Mode */}
              {getActiveSource()?.isFile ? (
                <div className="file-preview-container">
                  {getActiveSource()?.fileType === 'pdf' && getActiveSource()?.fileDataUrl && (
                    <object
                      data={getActiveSource()?.fileDataUrl}
                      type="application/pdf"
                      className="file-preview-pdf"
                    >
                      <p>PDF 미리보기를 지원하지 않는 브라우저입니다.</p>
                    </object>
                  )}
                  {getActiveSource()?.fileType === 'image' && getActiveSource()?.fileDataUrl && (
                    <img
                      src={getActiveSource()?.fileDataUrl}
                      alt={getActiveSource()?.title}
                      className="file-preview-image"
                    />
                  )}
                  {(getActiveSource()?.fileType === 'ppt' || getActiveSource()?.fileType === 'pptx') && (
                    <div className="file-preview-placeholder">
                      <div className="file-icon">📊</div>
                      <p className="file-name">{getActiveSource()?.title}</p>
                      <p className="file-type-info">PowerPoint 파일</p>
                      <p className="file-note">미리보기가 지원되지 않습니다.<br/>AI 작업은 텍스트 추출 후 수행됩니다.</p>
                    </div>
                  )}
                  {(getActiveSource()?.fileType === 'xls' || getActiveSource()?.fileType === 'xlsx') && (
                    <div className="file-preview-placeholder">
                      <div className="file-icon">📈</div>
                      <p className="file-name">{getActiveSource()?.title}</p>
                      <p className="file-type-info">Excel 파일</p>
                      <p className="file-note">미리보기가 지원되지 않습니다.<br/>AI 작업은 텍스트 추출 후 수행됩니다.</p>
                    </div>
                  )}
                  {(getActiveSource()?.fileType === 'doc' || getActiveSource()?.fileType === 'docx') && (
                    <div className="file-preview-placeholder">
                      <div className="file-icon">📄</div>
                      <p className="file-name">{getActiveSource()?.title}</p>
                      <p className="file-type-info">Word 파일</p>
                      <p className="file-note">미리보기가 지원되지 않습니다.<br/>AI 작업은 텍스트 추출 후 수행됩니다.</p>
                    </div>
                  )}
                </div>
              ) : sourceEditMode ? (
                <textarea
                  className="source-textarea"
                  value={getActiveSource()?.content || ""}
                  onChange={(e) => {
                    const source = getActiveSource();
                    if (source) {
                      updateSourceContent(source.id, e.target.value);
                    }
                  }}
                  onPaste={(e) => {
                    // If no source exists, create one from pasted content
                    if (!getActiveSource()) {
                      e.preventDefault();
                      const pastedText = e.clipboardData.getData("text");
                      if (pastedText.trim()) {
                        addManualSource(pastedText);
                      }
                    }
                  }}
                  placeholder="Paste or type content here..."
                  autoFocus
                />
              ) : getActiveSource() ? (
                <div
                  className="content-text"
                  onDoubleClick={() => setSourceEditMode(true)}
                  draggable
                  onDragStart={(e) => {
                    if (selectedText) {
                      handleDragStart(e, selectedText);
                    }
                  }}
                  onDragEnd={handleDragEnd}
                >
                  {getActiveSource()?.content}
                </div>
              ) : (
                <div
                  className="placeholder editable-placeholder file-drop-zone"
                  onClick={() => setSourceEditMode(true)}
                  onDrop={handleFileDrop}
                  onDragOver={handleFileDragOver}
                  tabIndex={0}
                >
                  <div className="drop-zone-content">
                    <span className="drop-icon">📁</span>
                    <p>클릭하여 편집하거나, 콘텐츠를 붙여넣거나,<br/>파일을 드래그 앤 드롭하세요.</p>
                    <span className="supported-files">(PDF, PPT, XLS, DOC, 이미지 지원)</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Panel - Notes */}
        <div className={`panel right-panel ${focusMode ? "focus-panel" : ""} ${isDragging ? "drop-target" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <div className="panel-header">
            <h2>Notes</h2>
            <div className="panel-actions">
              <button
                className={`small-button mode-toggle ${noteViewMode === "edit" ? "active" : "secondary"}`}
                onClick={() => setNoteViewMode(noteViewMode === "edit" ? "view" : "edit")}
              >
                {noteViewMode === "edit" ? "View" : "Edit"}
              </button>
              {notes.length > 0 && (
                <>
                  <div className="export-group">
                    <select
                      value={exportFormat}
                      onChange={e => setExportFormat(e.target.value as typeof exportFormat)}
                      className="export-format-select"
                    >
                      <option value="md">Markdown</option>
                      <option value="txt">Text</option>
                      <option value="html">HTML</option>
                      <option value="json">JSON</option>
                    </select>
                    <button className="small-button" onClick={handleExportNotes}>
                      📤 Export
                    </button>
                  </div>
                  <button className="small-button secondary" onClick={clearNotes}>
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Advanced Filters */}
          <div className="advanced-filters">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="filter-select"
            >
              <option value="all">모든 유형</option>
              <option value="question">질문</option>
              <option value="summary">요약</option>
              <option value="translation">번역</option>
              <option value="highlight">인용</option>
              <option value="text">텍스트</option>
            </select>
            <select
              value={filterDateRange}
              onChange={e => setFilterDateRange(e.target.value)}
              className="filter-select"
            >
              <option value="all">전체 기간</option>
              <option value="today">오늘</option>
              <option value="week">최근 7일</option>
              <option value="month">최근 30일</option>
            </select>
            <button
              className={`filter-toggle ${filterImportant ? "active" : ""}`}
              onClick={() => setFilterImportant(!filterImportant)}
              title="중요 항목만"
            >
              ⭐
            </button>
          </div>

          {/* Tag filter */}
          {getAllTags().length > 0 && (
            <div className="tag-filter">
              {getAllTags().map(tag => (
                <button
                  key={tag}
                  className={`tag-button ${selectedTags.includes(tag) ? "active" : ""}`}
                  onClick={() => {
                    setSelectedTags(prev =>
                      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                    );
                  }}
                >
                  #{tag}
                </button>
              ))}
              {selectedTags.length > 0 && (
                <button className="tag-clear" onClick={() => setSelectedTags([])}>
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Search */}
          <div className="notes-search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Search notes..."
              className="search-input"
            />
          </div>

          <div className="panel-content notes-content">
            {noteViewMode === "edit" ? (
              <textarea
                className="notes-textarea"
                value={rawNoteText}
                onChange={(e) => setRawNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setNoteViewMode("view");
                }}
                placeholder="Your notes will appear here..."
                autoFocus
              />
            ) : (
              <div
                className="notes-viewer"
                onDoubleClick={() => setNoteViewMode("edit")}
                onMouseUp={() => {
                  // Capture selected text from notes panel
                  const selection = window.getSelection();
                  if (selection && selection.toString().trim()) {
                    setSelectedNoteText(selection.toString().trim());
                  }
                }}
              >
                {getFilteredNotes().length > 0 ? (
                  getFilteredNotes().map(note => (
                    <div
                      key={note.id}
                      className={`note-card ${note.type} ${note.isImportant ? "important" : ""}`}
                      style={{
                        borderLeftColor: sources.find(s => s.id === note.sourceId)?.color || "#666"
                      }}
                    >
                      <div className="note-header">
                        <span className="note-type">
                          {note.type === "question" && "❓"}
                          {note.type === "summary" && "📝"}
                          {note.type === "translation" && "🌐"}
                          {note.type === "highlight" && "📌"}
                          {note.type === "text" && "✏️"}
                        </span>
                        {note.aiModel && <span className="note-model">{note.aiModel}</span>}
                        <div className="note-actions">
                          <button
                            className="note-action-btn"
                            onClick={() => {
                              setSelectedNoteForHistory(note.id);
                              setShowVersionHistory(true);
                            }}
                            title="버전 히스토리"
                          >
                            🕐
                          </button>
                          <button
                            className={`note-star ${note.isImportant ? "active" : ""}`}
                            onClick={() => toggleNoteImportant(note.id)}
                          >
                            ⭐
                          </button>
                          <button
                            className="note-delete"
                            onClick={() => deleteNote(note.id)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="note-body">
                        <ReactMarkdown>{note.content}</ReactMarkdown>
                      </div>
                      {note.tags.length > 0 && (
                        <div className="note-tags">
                          {note.tags.map(t => <span key={t} className="tag">#{t}</span>)}
                        </div>
                      )}
                      <input
                        type="text"
                        className="add-tag-input"
                        placeholder="Add tag..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value.trim()) {
                            addTagToNote(note.id, e.currentTarget.value.trim());
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </div>
                  ))
                ) : (
                  <div className="placeholder">
                    {isDragging ? (
                      <span className="drop-hint">여기에 드롭하여 노트에 추가</span>
                    ) : (
                      "Your notes will appear here. Use the actions below or double-click to edit."
                    )}
                  </div>
                )}
              </div>
            )}
            <div ref={notesEndRef} />
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="actions-bar">
        {!focusMode && (
          <>
            <button
              onClick={handleTranslate}
              disabled={loading || !canPerformAction}
              className="action-button translate"
            >
              🌐 번역
            </button>

            <button
              onClick={handleSummarize}
              disabled={loading || !canPerformAction}
              className="action-button summarize"
            >
              📝 요약
            </button>

            {/* Template buttons - individual buttons instead of dropdown */}
            {ANALYSIS_TEMPLATES.map(template => (
              <button
                key={template.id}
                onClick={() => handleTemplateAnalysis(template)}
                disabled={loading || !canPerformAction}
                className="action-button template"
                title={template.prompt}
              >
                {template.icon} {template.name}
              </button>
            ))}
          </>
        )}

        <div className="question-group">
          {selectedNoteText && (
            <div className="selected-text-indicator">
              <span className="selected-text-label">📝 선택:</span>
              <span className="selected-text-preview">
                "{selectedNoteText.slice(0, 50)}{selectedNoteText.length > 50 ? '...' : ''}"
              </span>
              <button
                className="clear-selection-btn"
                onClick={() => setSelectedNoteText("")}
              >
                ×
              </button>
            </div>
          )}
          <div className="prompt-preset-trigger">
            <button
              className="small-button secondary"
              onClick={() => setShowPromptPresets(!showPromptPresets)}
              title="프롬프트 프리셋"
            >
              💬
            </button>
            {showPromptPresets && (
              <div className="prompt-preset-menu">
                {Object.entries(
                  promptPresets.reduce((acc, p) => {
                    if (!acc[p.category]) acc[p.category] = [];
                    acc[p.category].push(p);
                    return acc;
                  }, {} as Record<string, PromptPreset[]>)
                ).map(([category, presets]) => (
                  <div key={category} className="preset-category">
                    <div className="preset-category-label">{category}</div>
                    {presets.map(preset => (
                      <button
                        key={preset.id}
                        className="preset-item"
                        onClick={() => {
                          setQuestion(preset.prompt);
                          setShowPromptPresets(false);
                          questionInputRef.current?.focus();
                        }}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <input
            ref={questionInputRef}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={selectedNoteText ? "선택된 텍스트에 대해 질문하세요..." : "Ask a question about your notes..."}
            className="question-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading && canAsk) {
                handleAskQuestion();
              }
            }}
          />
          <select
            value={selectedAiModel}
            onChange={(e) => setSelectedAiModel(e.target.value as AiModel)}
            className="ai-model-select"
          >
            <option value="claude" disabled={!apiKeySet}>Claude</option>
            <option value="openai" disabled={!openaiKeySet}>GPT-4o</option>
            <option value="gemini" disabled={!geminiKeySet}>Gemini</option>
          </select>
          <button
            onClick={() => handleAskQuestion()}
            disabled={loading || !canAsk || !question.trim()}
            className="action-button ask"
          >
            Ask
          </button>
          {!focusMode && (
            <button
              onClick={() => setShowModelComparison(true)}
              disabled={loading || !canAsk}
              className="action-button compare"
              title="멀티모델 비교"
            >
              ⚖️
            </button>
          )}
        </div>
      </div>

      {/* Follow-up suggestions */}
      {showFollowUp && lastConversationId && (
        <div className="follow-up-bar">
          <span className="follow-up-label">Follow up:</span>
          {followUpQuestions.map((q, idx) => (
            <button
              key={idx}
              className="follow-up-btn"
              onClick={() => handleFollowUp(q)}
              disabled={loading}
            >
              {q}
            </button>
          ))}
          <button
            className="follow-up-close"
            onClick={() => setShowFollowUp(false)}
          >
            ×
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="error-bar">
          <strong>Error:</strong> {error}
          <button className="close-button" onClick={() => setError("")}>×</button>
        </div>
      )}

      {/* Settings Toggle */}
      {!focusMode && (
        <div className="settings-toggle" onClick={() => setShowSettings(!showSettings)}>
          <span>⚙️ Settings</span>
          <span className="toggle-icon">{showSettings ? "▼" : "▶"}</span>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && !focusMode && (
        <div className="settings-panel">
          <div className="setting-row">
            <label>Claude API Key:</label>
            {apiKeySet ? (
              <div className="input-group">
                <span className="status success">✓ Saved</span>
                <button onClick={() => handleClearApiKey("claude")} className="small-button danger">Clear</button>
              </div>
            ) : (
              <div className="input-group">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                />
                <button onClick={() => handleSetApiKey("claude")} className="small-button">Save</button>
              </div>
            )}
          </div>

          <div className="setting-row">
            <label>OpenAI API Key:</label>
            {openaiKeySet ? (
              <div className="input-group">
                <span className="status success">✓ Saved</span>
                <button onClick={() => handleClearApiKey("openai")} className="small-button danger">Clear</button>
              </div>
            ) : (
              <div className="input-group">
                <input
                  type="password"
                  value={openaiKeyInput}
                  onChange={(e) => setOpenaiKeyInput(e.target.value)}
                  placeholder="sk-..."
                />
                <button onClick={() => handleSetApiKey("openai")} className="small-button">Save</button>
              </div>
            )}
          </div>

          <div className="setting-row">
            <label>Gemini API Key:</label>
            {geminiKeySet ? (
              <div className="input-group">
                <span className="status success">✓ Saved</span>
                <button onClick={() => handleClearApiKey("gemini")} className="small-button danger">Clear</button>
              </div>
            ) : (
              <div className="input-group">
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder="AIza..."
                />
                <button onClick={() => handleSetApiKey("gemini")} className="small-button">Save</button>
              </div>
            )}
          </div>

          <div className="setting-row">
            <label>Notion Token:</label>
            {notionTokenSet ? (
              <div className="input-group">
                <span className="status success">✓ Saved</span>
              </div>
            ) : (
              <div className="input-group">
                <input
                  type="password"
                  value={notionTokenInput}
                  onChange={(e) => setNotionTokenInput(e.target.value)}
                  placeholder="ntn_..."
                />
                <button onClick={() => handleSetApiKey("notion")} className="small-button">Save</button>
              </div>
            )}
          </div>

          <div className="setting-row">
            <label>클립보드 모니터링:</label>
            <div className="input-group">
              <button
                onClick={() => setClipboardMonitoring(!clipboardMonitoring)}
                className={`small-button ${clipboardMonitoring ? "active" : "secondary"}`}
              >
                {clipboardMonitoring ? "활성화됨" : "비활성화"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {!apiKeySet && !focusMode && (
        <div className="warning-bar">
          Please set your Claude API key in Settings to use the app.
        </div>
      )}

      {/* Project Modal */}
      {showProjectModal && (
        <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Projects</h3>
              <button className="close-button" onClick={() => setShowProjectModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="new-project-form">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="New project name..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newProjectName.trim()) {
                      createProject(newProjectName.trim());
                    }
                  }}
                />
                <button
                  className="small-button"
                  onClick={() => createProject(newProjectName.trim())}
                  disabled={!newProjectName.trim()}
                >
                  Create
                </button>
              </div>
              <div className="project-list">
                {projects.map(project => (
                  <div
                    key={project.id}
                    className={`project-item ${currentProject?.id === project.id ? "active" : ""}`}
                    onClick={() => {
                      setCurrentProject(project);
                      setShowProjectModal(false);
                    }}
                  >
                    <span className="project-name">📁 {project.name}</span>
                    <span className="project-date">
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-modal">
            <div className="loading-spinner-large"></div>
            <div className="loading-message">
              {activeAction === "translate" && "번역 중..."}
              {activeAction === "summarize" && "요약 중..."}
              {activeAction === "question" && "AI 응답 대기 중..."}
              {!activeAction && "처리 중..."}
            </div>
            <div className="loading-submessage">
              {activeAction === "translate" && "문서를 한국어로 번역하고 있습니다"}
              {activeAction === "summarize" && "핵심 내용을 요약하고 있습니다"}
              {activeAction === "question" && "질문에 대한 답변을 생성하고 있습니다"}
            </div>
          </div>
        </div>
      )}

      {/* Status Bar */}
      {!focusMode && (
        <footer className="status-bar">
          {loading && (
            <div className="status-item loading-status">
              <span className="loading-spinner"></span>
              <span className="loading-text">
                {activeAction === "translate" && "번역 중..."}
                {activeAction === "summarize" && "요약 중..."}
                {activeAction === "question" && "응답 대기 중..."}
              </span>
            </div>
          )}
          {lastApiUsage && !loading && (
            <div className="status-item api-usage">
              <span className="api-model">{lastApiUsage.model}</span>
              <span className="api-tokens">{lastApiUsage.inputTokens.toLocaleString()} + {lastApiUsage.outputTokens.toLocaleString()} tokens</span>
              <span className="api-cost">~${lastApiUsage.cost.toFixed(4)}</span>
            </div>
          )}
          <div className="status-item total-cost">
            <span className="total-cost-label">Session:</span>
            <span className="total-cost-value">${totalCost.toFixed(4)}</span>
          </div>
          <div className="status-item">
            <span className="source-count">{sources.length} sources</span>
            <span className="note-count">{notes.length} notes</span>
          </div>
          <div className="status-item">
            {mcpConnecting ? (
              <span className="status connecting">Connecting MCP...</span>
            ) : mcpConnected ? (
              <span className="status success">MCP Connected</span>
            ) : (
              <span className="status disconnected">MCP Disconnected</span>
            )}
          </div>
        </footer>
      )}
    </main>
  );
}

export default App;
