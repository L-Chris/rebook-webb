import { Fragment, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  ListTree,
  Loader2,
  LogIn,
  LogOut,
  Maximize2,
  Menu,
  MessageSquareText,
  Minimize2,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  UserRound,
  Volume2,
  X,
} from 'lucide-react'
import { createOpenAI } from '@ai-sdk/openai'
import { jsonSchema, tool, type ToolSet } from 'ai'
import {
  BrowserDOMAdapter,
  BrowserURLFactory,
  EBookError,
  UnsupportedFormatError,
  createAIChatExtension,
  createBrowserTTSAudioPlayer,
  createBuiltInRebookExtensionCatalog,
  createProfessionalTranslationExtension,
  createReader,
  createRebookExtensionCatalog,
  createRebookExtensionManager,
  createTTSExtension,
  createTranslationExtension,
  AI_CHAT_EXTENSION_ID,
  PROFESSIONAL_TRANSLATION_EXTENSION_ID,
  TRANSLATION_EXTENSION_ID,
  TRIAL_LIMIT_EXTENSION_ID,
  TTS_EXTENSION_ID,
  getReadableContentUnit,
  getReadableContentUnits,
  loadRebookExtensionModule,
  registerBuiltInParsers,
  registry,
  resolveReadableContentUnitIndex,
  setRebookDebug,
  type RebookExtension,
  type RebookExtensionCatalogEntry,
  type RebookExtensionCatalogItem,
  type RebookExtensionInstallation,
  type RebookExtensionManifest,
  type RendererStyles,
  type TOCItem,
  type TOCViewItem,
  parseRebookExtensionCatalogEntries,
} from 'rebook'
import {
  apiFetch,
  apiRequest,
  apiUrl,
  assetUrl,
  type ShelfItem,
} from '../../lib/api'
import {
  extractBookCover,
  getLocalBook,
  isLocalBookId,
  updateLocalBookMetadata,
  updateLocalBookProgress,
} from '../../lib/local-library'
import {
  CJK_FONT_OPTIONS,
  MONOSPACE_FONT_OPTIONS,
  READER_FONT_DEFAULTS,
  SANS_SERIF_FONT_OPTIONS,
  SERIF_FONT_OPTIONS,
  ensureReaderFontsLoaded,
  getReaderFontFamilies,
  type ReaderDefaultFont,
} from '../../lib/reader-fonts'
import {
  BUILT_IN_EXTENSION_DEFAULTS_VERSION,
  READER_CONFIG_STORAGE_KEY,
} from '../../lib/extension-marketplace'
import { useAppTheme } from '../theme/ThemeContext'
import {
  iconButtonClass,
  inputClass,
  menuRowClass,
  primaryButtonClass,
  roundIconButtonClass,
  toolbarButtonClass,
} from '../../lib/ui-classes'

type ReflowablePageFitMode = NonNullable<RendererStyles['reflowablePageFit']>
type Panel = 'chat' | null
type SidebarView = 'toc' | 'search'
type SettingsSection = 'font' | 'reading' | 'extensions' | 'translation' | 'tts' | 'chat' | 'debug'
type DemoExtensionInstallations = Record<string, RebookExtensionInstallation>
type DemoExtensionRuntimeStatus = Record<string, { state: 'loaded' | 'loading' | 'error' | 'idle'; message: string }>

interface DemoConfig {
  layout: 'paginated' | 'scrolled'
  spread: string
  fixedPainter: string
  reflowablePageFit: ReflowablePageFitMode
  fontSize: string
  defaultFont: ReaderDefaultFont
  defaultCJKFont: string
  serifFont: string
  sansSerifFont: string
  monospaceFont: string
  overrideBookFonts: boolean
  hyphenate: boolean
  debug: boolean
  translate: boolean
  translateTOC: boolean
  professionalTranslation: boolean
  professionalServiceBaseUrl: string
  professionalBookId: string
  baseURL: string
  apiKey: string
  model: string
  translateMode: 'bilingual' | 'replace'
  prefetchPages: string
  tts: boolean
  ttsEndpoint: string
  ttsProvider: string
  ttsSoundEffectProvider: string
  ttsVoice: string
  ttsSegmentChars: string
  ttsSpeed: string
  ttsMultiSpeaker: boolean
  ttsAIBaseURL: string
  ttsAIAPIKey: string
  ttsModel: string
  ttsNarratorVoice: string
  ttsMaleVoices: string
  ttsFemaleVoices: string
  ttsOtherVoice: string
  chat: boolean
  chatBaseURL: string
  chatAPIKey: string
  chatModel: string
  chatMaxContentChars: string
  chatPanelWidth: string
  extensionDefaultsVersion: number
  extensionCatalogURL: string
  extensionCatalogJSON: string
  extensionInstallations: DemoExtensionInstallations
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  displayContent?: string
  attachments?: ChatAttachment[]
  references?: ChatReference[]
  pending?: boolean
}

interface ChatAttachment {
  id: string
  name: string
  mediaType: string
  data: string
  previewUrl: string
}

interface ChatReference {
  id: string
  kind: 'section' | 'paragraph'
  label: string
  description: string
  href: string
  unitIndex: number
  blockId?: string
  excerpt?: string
}

interface SearchItem {
  unitIndex: number
  unitId: string | number
  unitKind: string
  unitTitle?: string
  sectionIndex?: number
  pageIndex?: number
  blockId?: string
  blockType?: string
  start: number
  end: number
  before: string
  excerpt: string
  match: string
  after: string
}

type DemoTOCItem = (TOCViewItem | TOCItem) & {
  id?: string
  target?: string
  disabled?: boolean
  active?: boolean
  children?: readonly DemoTOCItem[]
  subitems?: readonly DemoTOCItem[]
}

interface ReflowDebugLine {
  lineIndex: number
  blockId: string | null
  blockType: string | null
  sourceTop: number | null
  sourceHeight: number | null
  styleTop: number | null
  styleLeft: number | null
  rect: {
    x: number
    y: number
    width: number
    height: number
    bottom: number
  }
  text: string
  imageSrc: string | null
}

type ReflowDebugIssueKind = 'caption-before-image' | 'distant-caption' | 'missing-caption'

interface ReflowDebugFigurePair {
  image: ReflowDebugLine
  caption: ReflowDebugLine | null
  visualGap: number | null
  issue: ReflowDebugIssueKind | null
}

type StoryEntityKind = 'character' | 'person' | 'location' | 'organization' | 'event' | 'concept' | 'all'

interface StoryMemoryToolConfig {
  serviceBaseUrl: string
  bookId: string
}

interface ReflowDebugSnapshot {
  pageIndex: number | null
  location: ReturnType<typeof summarizeLocation>
  viewport: { width: number; height: number }
  frame: { x: number; y: number; width: number; height: number } | null
  rowRange: [number, number] | null
  pairs: ReflowDebugFigurePair[]
  issues: ReflowDebugFigurePair[]
}

type ReflowDebugScanOptions = { pages?: number; direction?: 'next' | 'prev'; stopOnIssue?: boolean }

interface RebookDebugTools {
  version: string
  help(): unknown
  figures(): ReflowDebugSnapshot
  scanFigures(): ReflowDebugSnapshot
  logFigures(): ReflowDebugSnapshot
  copyFigures(): Promise<ReflowDebugSnapshot>
  go(target: string | number): Promise<ReflowDebugSnapshot>
  next(): Promise<ReflowDebugSnapshot>
  prev(): Promise<ReflowDebugSnapshot>
  goTo(target: string | number): Promise<ReflowDebugSnapshot>
  refresh(): Promise<ReflowDebugSnapshot>
  scan(options?: ReflowDebugScanOptions): Promise<ReflowDebugSnapshot[]>
  scanPages(options?: ReflowDebugScanOptions): Promise<ReflowDebugSnapshot[]>
  find(pages?: number): Promise<ReflowDebugSnapshot[]>
  findFigureIssues(pages?: number): Promise<ReflowDebugSnapshot[]>
  block(blockId: string): Promise<ReflowDebugSnapshot>
  sections(): unknown
  jumpToBlock(blockId: string): Promise<void>
  location(): unknown
  getLocation(): unknown
  reader(): unknown
  book(): unknown
}

const CONFIG_KEY = READER_CONFIG_STORAGE_KEY
const MAX_SEARCH_RESULTS = 80
const MAX_CHAT_REFERENCE_OPTIONS = 120
const MAX_CHAT_REFERENCE_SUGGESTIONS = 8
const MAX_CHAT_REFERENCE_EXCERPT = 220
const configuredRebookServiceUrl = String(import.meta.env.VITE_REBOOK_SERVICE_URL ?? '').trim()
const defaultRebookServiceUrl = configuredRebookServiceUrl
  || (import.meta.env.DEV ? 'http://127.0.0.1:8083' : 'https://read.rethinkos.com/api')

interface ChatCommand {
  name: '/summary' | '/search' | '/rewrite' | '/extract' | '/story-index' | '/timeline' | '/profile' | '/relations' | '/entities'
  description: string
  insertText: string
  requiresArgs?: boolean
  missingArgsMessage?: string
  buildPrompt(args: string): string
}

const CHAT_COMMANDS: ChatCommand[] = [
  {
    name: '/summary',
    description: '总结当前章节内容',
    insertText: '/summary',
    buildPrompt: () => '请总结当前章节内容。要求：用中文回答；先给出一句话概括，再列出关键要点；如果章节中有重要术语，请单独解释。',
  },
  {
    name: '/search',
    description: '搜索书籍内容并整理答案',
    insertText: '/search ',
    requiresArgs: true,
    missingArgsMessage: '请输入搜索关键词，例如 `/search feedback loops`。',
    buildPrompt: args => `请在本书中搜索与“${args}”相关的信息，优先使用搜索工具。请用中文回答，列出最相关的章节或段落，并简要解释上下文。`,
  },
  {
    name: '/rewrite',
    description: '改写当前章节正文',
    insertText: '/rewrite ',
    buildPrompt: args => {
      const extra = args
        ? `\n额外改写要求：${args}`
        : ''
      return `请改写当前章节正文，默认改成更通俗易懂的中文。必须调用 rewriteBlocks 修改实际渲染文本，不要只在回答中贴改写结果。保留原文核心信息、术语和逻辑；不要修改图片或表格；完成后只简要说明已改写完成。${extra}`
    },
  },
  {
    name: '/extract',
    description: '提取当前章节关键概念',
    insertText: '/extract',
    buildPrompt: () => '请提取当前章节的关键概念。要求：用中文回答；先列出概念清单，再分别解释每个概念的含义、它在本章中的作用，以及概念之间的关系；涉及本章具体内容时添加可点击引用。',
  },
  {
    name: '/story-index',
    description: '索引本书故事记忆',
    insertText: '/story-index',
    buildPrompt: args => {
      const extra = args ? `\n额外索引要求：${args}` : ''
      return `请调用 indexStoryMemory 为当前后端书籍建立故事记忆索引。默认索引本书前 80 个 chunk；完成后只简要说明索引状态、bookId、indexedChunks。${extra}`
    },
  },
  {
    name: '/timeline',
    description: '整理故事事件时间线',
    insertText: '/timeline ',
    buildPrompt: args => `请结合 story memory 工具整理本书事件时间线。${args ? `重点关注：${args}。` : ''}要求：先调用 getStoryTimeline；必要时再用 searchBook 或 getContent 补充原文依据；最终回答用中文，并给关键事件添加可点击引用。`,
  },
  {
    name: '/profile',
    description: '查询人物细节',
    insertText: '/profile ',
    requiresArgs: true,
    missingArgsMessage: '请输入人物名称，例如 `/profile 哈利`。',
    buildPrompt: args => `请结合 story memory 工具整理“${args}”的人物档案。要求：调用 getCharacterProfile；说明身份、别名、性格/动机、重要行动和出场证据；最终回答用中文，并给关键结论添加可点击引用。`,
  },
  {
    name: '/relations',
    description: '查询人物关系',
    insertText: '/relations ',
    requiresArgs: true,
    missingArgsMessage: '请输入人物名称，例如 `/relations 哈利`。',
    buildPrompt: args => `请结合 story memory 工具整理“${args}”的人物关系。要求：调用 getCharacterRelationships；必要时再调用 getCharacterProfile 或 searchStoryMemory；最终回答用中文，并给关系结论添加可点击引用。`,
  },
  {
    name: '/entities',
    description: '提取人物地点事件',
    insertText: '/entities ',
    buildPrompt: args => `请结合 story memory 工具提取本书中的人物、地点、组织和事件。${args ? `筛选要求：${args}。` : ''}要求：调用 getStoryEntities；按类型分组；最终回答用中文，并尽量附可点击引用。`,
  },
]

const defaultConfig: DemoConfig = {
  layout: 'paginated',
  spread: '2',
  fixedPainter: 'canvas',
  reflowablePageFit: 'viewport',
  fontSize: '16px',
  ...READER_FONT_DEFAULTS,
  overrideBookFonts: false,
  hyphenate: true,
  debug: false,
  translate: false,
  translateTOC: false,
  professionalTranslation: false,
  professionalServiceBaseUrl: defaultRebookServiceUrl,
  professionalBookId: '',
  baseURL: '',
  apiKey: '',
  model: '',
  translateMode: 'bilingual',
  prefetchPages: '2',
  tts: false,
  ttsEndpoint: 'http://127.0.0.1:4177',
  ttsProvider: 'default',
  ttsSoundEffectProvider: 'elevenlabs',
  ttsVoice: 'zh-CN-XiaoyiNeural',
  ttsSegmentChars: '500',
  ttsSpeed: '1',
  ttsMultiSpeaker: false,
  ttsAIBaseURL: '',
  ttsAIAPIKey: '',
  ttsModel: '',
  ttsNarratorVoice: 'zh-CN-YunxiNeural',
  ttsMaleVoices: 'zh-CN-YunjianNeural, zh-CN-YunxiNeural',
  ttsFemaleVoices: 'zh-CN-XiaoyiNeural, zh-CN-XiaoxiaoNeural',
  ttsOtherVoice: 'zh-CN-XiaoxiaoNeural',
  chat: true,
  chatBaseURL: '',
  chatAPIKey: '',
  chatModel: '',
  chatMaxContentChars: '6000',
  chatPanelWidth: '420',
  extensionDefaultsVersion: BUILT_IN_EXTENSION_DEFAULTS_VERSION,
  extensionCatalogURL: '',
  extensionCatalogJSON: '',
  extensionInstallations: {},
}

function readStoryMemoryToolConfig(config: DemoConfig): StoryMemoryToolConfig | null {
  const serviceBaseUrl = config.professionalServiceBaseUrl.trim()
  const bookId = config.professionalBookId.trim()
  if (!serviceBaseUrl || !bookId) return null
  return { serviceBaseUrl, bookId }
}

function buildStoryMemorySystemPrompt(config: DemoConfig): string | undefined {
  const storyMemory = readStoryMemoryToolConfig(config)
  if (!storyMemory) return undefined
  return [
    '# Story Memory 工具',
    '- 当前 AI Chat 已接入 rebook-service story memory，可用于跨章节检索人物、地点、组织、事件、人物关系、人物细节和故事时间线。',
    '- 当用户询问“时间线”“人物关系”“人物细节”“角色背景”“地点/组织/事件”“前因后果”时，优先调用 story memory 工具：getStoryTimeline、getStoryEntities、getCharacterProfile、getCharacterRelationships 或 searchStoryMemory。',
    '- 如果 story memory 工具返回的候选证据缺少 rebook://j/ 引用，必须再调用 searchBook、getContent 或 getCurrentContext 补充原文出处。',
    '- 只有当用户明确要求“索引/建立故事记忆/刷新故事记忆”时，才调用 indexStoryMemory；不要在普通问答中自动索引。',
    `- 当前 story memory bookId: ${storyMemory.bookId}`,
  ].join('\n')
}

function createStoryMemoryTools(
  storyMemory: StoryMemoryToolConfig | null,
  onLog?: (event: unknown) => void,
): ToolSet {
  return {
    indexStoryMemory: tool({
      description: '为当前后端书籍建立或刷新 story memory 索引。只在用户明确要求索引、刷新或建立故事记忆时调用；普通问答不要调用。',
      inputSchema: jsonSchema<{ chapterIndex?: number; maxChunks?: number; extraInstructions?: string }>({
        type: 'object',
        properties: {
          chapterIndex: { type: 'number', description: '只索引指定章节；不填则按 maxChunks 从全书开始索引。' },
          maxChunks: { type: 'number', description: '最多索引多少个 chunk，默认 80。' },
          extraInstructions: { type: 'string', description: '额外抽取要求。' },
        },
        additionalProperties: false,
      }),
      execute: async input => compactStoryIndexResponse(await callStoryMemoryTool(storyMemory, '/index', {
        method: 'POST',
        body: {
          chapterIndex: input.chapterIndex,
          maxChunks: input.maxChunks ?? 80,
          extraInstructions: input.extraInstructions,
        },
      }, onLog)),
    }),
    getStoryChapters: tool({
      description: '获取后端书籍章节结构和每章首段引用，用于把 story memory 结果映射回章节。',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => callStoryMemoryTool(storyMemory, '/chapters', { method: 'GET' }, onLog),
    }),
    searchStoryMemory: tool({
      description: '在当前书籍 story memory 中搜索情节事实、人物、地点、组织、概念和带出处的证据。',
      inputSchema: jsonSchema<{ query: string; limit?: number }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索问题或关键词。' },
          limit: { type: 'number', description: '最多返回候选数量，默认 12。' },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async input => callStoryMemoryTool(storyMemory, '/search', {
        method: 'POST',
        body: input,
      }, onLog),
    }),
    getStoryTimeline: tool({
      description: '获取当前书籍的故事事件时间线候选，用于回答事件顺序、前因后果、情节发展。',
      inputSchema: jsonSchema<{ query?: string; limit?: number }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选筛选条件，例如人物名、章节名或事件关键词。' },
          limit: { type: 'number', description: '最多返回事件数量，默认 24。' },
        },
        additionalProperties: false,
      }),
      execute: async input => callStoryMemoryTool(storyMemory, '/timeline', {
        method: 'POST',
        body: input,
      }, onLog),
    }),
    getStoryEntities: tool({
      description: '检索当前书籍的人物、地点、组织、事件或关键概念。',
      inputSchema: jsonSchema<{ kind?: StoryEntityKind; query?: string; limit?: number }>({
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['character', 'person', 'location', 'organization', 'event', 'concept', 'all'],
            description: '实体类型，不填默认 all。',
          },
          query: { type: 'string', description: '可选筛选关键词。' },
          limit: { type: 'number', description: '最多返回候选数量，默认 12。' },
        },
        additionalProperties: false,
      }),
      execute: async input => callStoryMemoryTool(storyMemory, '/entities', {
        method: 'POST',
        body: input,
      }, onLog),
    }),
    getCharacterProfile: tool({
      description: '查询人物档案候选，包括身份、别名、性格、动机、目标、重要行动和证据。',
      inputSchema: jsonSchema<{ name: string; limit?: number }>({
        type: 'object',
        properties: {
          name: { type: 'string', description: '人物名称或别名。' },
          limit: { type: 'number', description: '最多返回证据数量，默认 16。' },
        },
        required: ['name'],
        additionalProperties: false,
      }),
      execute: async input => callStoryMemoryTool(storyMemory, '/characters/profile', {
        method: 'POST',
        body: input,
      }, onLog),
    }),
    getCharacterRelationships: tool({
      description: '查询某个人物周围的人物关系和互动事实。',
      inputSchema: jsonSchema<{ name: string; limit?: number }>({
        type: 'object',
        properties: {
          name: { type: 'string', description: '人物名称或别名。' },
          limit: { type: 'number', description: '最多返回关系事实数量，默认 20。' },
        },
        required: ['name'],
        additionalProperties: false,
      }),
      execute: async input => callStoryMemoryTool(storyMemory, '/characters/relationships', {
        method: 'POST',
        body: input,
      }, onLog),
    }),
  }
}

async function callStoryMemoryTool(
  config: StoryMemoryToolConfig | null,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  onLog?: (event: unknown) => void,
) {
  if (!config) {
    return {
      ok: false,
      error: 'Story memory is not configured. Fill Chat settings: Story service URL and Story book ID, then apply settings/reopen the book.',
    }
  }
  return callStoryMemory(config, path, init, onLog)
}

async function callStoryMemory(
  config: StoryMemoryToolConfig,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  onLog?: (event: unknown) => void,
) {
  const url = storyMemoryUrl(config, path)
  onLog?.({ url, method: init.method })
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
    const text = await response.text()
    const data = parseStoryMemoryResponse(text)
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: storyMemoryErrorText(data, text),
      }
    }
    return data
  } catch (error) {
    return {
      ok: false,
      error: formatError(error),
    }
  }
}

function storyMemoryUrl(config: StoryMemoryToolConfig, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return createRebookApiUrl(
    config.serviceBaseUrl,
    `/books/${encodeURIComponent(config.bookId)}/story-memory${suffix}`,
  )
}

function parseStoryMemoryResponse(text: string): unknown {
  if (!text.trim()) return { ok: true }
  try {
    return JSON.parse(text)
  } catch {
    return { ok: false, raw: text.slice(0, 1200) }
  }
}

function storyMemoryErrorText(data: unknown, fallback: string): string {
  if (isRecord(data) && typeof data.error === 'string') return data.error
  return fallback.slice(0, 1200)
}

function compactStoryIndexResponse(data: unknown) {
  if (!isRecord(data)) return data
  return {
    ok: data.ok,
    bookId: data.bookId,
    groupId: data.groupId,
    indexedChunks: data.indexedChunks,
    count: data.count,
    error: data.error,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const domAdapter = new BrowserDOMAdapter()
const urlFactory = new BrowserURLFactory()
const parserOptions = { domAdapter, urlFactory }
const builtInExtensionCatalog = createBuiltInRebookExtensionCatalog()

registerBuiltInParsers(registry)

export type ReaderWorkspaceProps = {
  libraryBookId?: string
  authenticated?: boolean
  accountLabel?: string
  onExit?: () => void
  onLogin?: () => void
  onLogout?: () => void
}

function ReaderWorkspace({
  libraryBookId,
  authenticated = false,
  accountLabel = '',
  onExit,
  onLogin,
  onLogout,
}: ReaderWorkspaceProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const readerRef = useRef<any>(null)
  const bookRef = useRef<any>(null)
  const currentFileRef = useRef<File | null>(null)
  const bookCoverUrlRef = useRef<string | null>(null)
  const progressSaveTimerRef = useRef<number | null>(null)
  const readerResetIdRef = useRef(0)
  const pendingProgressRef = useRef<{
    progress: number
    locator: ReturnType<typeof createShelfLocator>
  } | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const extensionRuntimeCacheRef = useRef(new Map<string, { installUrl: string; extension: RebookExtension }>())
  const ttsPlayer = useMemo(() => createBrowserTTSAudioPlayer(), [])

  const [config, setConfig] = useState<DemoConfig>(() => loadConfig())
  const configRef = useRef(config)
  const { theme: appTheme } = useAppTheme()
  const [draftConfig, setDraftConfig] = useState<DemoConfig>(config)
  const [marketplaceRuntimeExtensions, setMarketplaceRuntimeExtensions] = useState<RebookExtension[]>([])
  const [extensionRuntimeStatus, setExtensionRuntimeStatus] = useState<DemoExtensionRuntimeStatus>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('font')
  const [book, setBook] = useState<any>(null)
  const [libraryItem, setLibraryItem] = useState<ShelfItem | null>(null)
  const [bookTitle, setBookTitle] = useState('')
  const [bookAuthor, setBookAuthor] = useState('')
  const [bookCoverUrl, setBookCoverUrl] = useState<string | null>(null)
  const [tocItems, setTocItems] = useState<TOCViewItem[]>([])
  const [location, setLocation] = useState<any>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024)
  const [sidebarView, setSidebarView] = useState<SidebarView>('toc')
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try {
      return localStorage.getItem('rebook-reader-sidebar-pinned') !== 'false'
    } catch {
      return true
    }
  })
  const [activePanel, setActivePanel] = useState<Panel>(null)
  const [status, setStatus] = useState(libraryBookId ? '正在加载书籍…' : '请从书架选择一本书')
  const [busy, setBusy] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState<'unit' | 'book'>('book')
  const [searchResults, setSearchResults] = useState<SearchItem[]>([])
  const [searchStatus, setSearchStatus] = useState('书籍加载后即可搜索。')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([])
  const [chatReferences, setChatReferences] = useState<ChatReference[]>([])
  const [chatReferenceOptions, setChatReferenceOptions] = useState<ChatReference[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [chatPanelWidth, setChatPanelWidth] = useState(() => clampPanelWidth(config.chatPanelWidth))
  const [storyUploadBusy, setStoryUploadBusy] = useState(false)
  const [storyUploadStatus, setStoryUploadStatus] = useState('')
  const [ttsStatus, setTTSStatus] = useState('TTS plugin disabled.')
  const runtimeExtensionLoadKey = useMemo(() => JSON.stringify({
    catalog: config.extensionCatalogJSON,
    installations: config.extensionInstallations,
  }), [config.extensionCatalogJSON, config.extensionInstallations])

  configRef.current = config

  // The reader chrome and book content share the same app-level theme.
  useEffect(() => {
    readerRef.current?.setStyles?.(getReaderStyles(config, appTheme))
  }, [appTheme])

  useEffect(() => {
    if (!settingsOpen) return
    let cancelled = false
    void ensureReaderFontsLoaded(draftConfig).then(() => {
      if (!cancelled) readerRef.current?.setStyles?.(getReaderStyles(draftConfig, appTheme))
    })
    return () => {
      cancelled = true
    }
  }, [
    settingsOpen,
    draftConfig.defaultFont,
    draftConfig.defaultCJKFont,
    draftConfig.serifFont,
    draftConfig.sansSerifFont,
    draftConfig.monospaceFont,
    draftConfig.overrideBookFonts,
    draftConfig.fontSize,
  ])

  useEffect(() => {
    try {
      localStorage.setItem('rebook-reader-sidebar-pinned', String(sidebarPinned))
    } catch {
      // Keep the preference for this session when storage is unavailable.
    }
  }, [sidebarPinned])

  const replaceBookCover = useCallback((cover: Blob | null) => {
    if (bookCoverUrlRef.current) URL.revokeObjectURL(bookCoverUrlRef.current)
    const nextUrl = cover ? URL.createObjectURL(cover) : null
    bookCoverUrlRef.current = nextUrl
    setBookCoverUrl(nextUrl)
  }, [])

  useEffect(() => () => {
    if (bookCoverUrlRef.current) URL.revokeObjectURL(bookCoverUrlRef.current)
  }, [])

  useEffect(() => {
    if (!sidebarOpen || sidebarView !== 'search') return
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [sidebarOpen, sidebarView])

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (settingsOpen || event.altKey || event.shiftKey) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      setSidebarView('search')
      setSidebarOpen(true)
    }
    document.addEventListener('keydown', openSearch)
    return () => document.removeEventListener('keydown', openSearch)
  }, [settingsOpen])

  const pushDebugEntry = useCallback((label: string, payload: unknown = {}) => {
    console.log(`[demo] ${label}`, payload)
  }, [])

  const appendDebug = useCallback((label: string, payload: unknown = {}) => {
    if (!configRef.current.debug) return
    pushDebugEntry(label, payload)
  }, [pushDebugEntry])

  const flushShelfProgress = useCallback(async () => {
    if (!libraryBookId || !pendingProgressRef.current) return
    const pending = pendingProgressRef.current
    pendingProgressRef.current = null
    if (progressSaveTimerRef.current != null) {
      window.clearTimeout(progressSaveTimerRef.current)
      progressSaveTimerRef.current = null
    }
    try {
      if (isLocalBookId(libraryBookId)) {
        await updateLocalBookProgress(libraryBookId, pending.progress, pending.locator)
      } else {
        await apiRequest(`/shelf/items/${libraryBookId}/progress`, {
          method: 'PUT',
          json: pending,
          keepalive: true,
        })
      }
    } catch (error) {
      appendDebug('shelf progress save failed', formatError(error))
    }
  }, [appendDebug, libraryBookId])

  const scheduleShelfProgress = useCallback((event: any) => {
    if (!libraryBookId) return
    pendingProgressRef.current = {
      progress: typeof event?.totalFraction === 'number'
        ? Math.max(0, Math.min(1, event.totalFraction))
        : 0,
      locator: createShelfLocator(event),
    }
    if (progressSaveTimerRef.current != null) {
      window.clearTimeout(progressSaveTimerRef.current)
    }
    progressSaveTimerRef.current = window.setTimeout(() => {
      void flushShelfProgress()
    }, 1500)
  }, [flushShelfProgress, libraryBookId])

  useEffect(() => {
    if (!libraryBookId) return
    const flush = () => {
      void flushShelfProgress()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      void flushShelfProgress()
    }
  }, [flushShelfProgress, libraryBookId])

  useEffect(() => {
    const entries = getEnabledDemoMarketplaceExtensionItems(config)
    let cancelled = false
    if (!entries.length) {
      setMarketplaceRuntimeExtensions([])
      setExtensionRuntimeStatus({})
      return
    }

    const loadingStatus: DemoExtensionRuntimeStatus = {}
    for (const entry of entries) {
      loadingStatus[entry.manifest.id] = {
        state: entry.installUrl ? 'loading' : 'error',
        message: entry.installUrl ? 'Loading runtime module...' : 'No installUrl is configured for this extension.',
      }
    }
    setExtensionRuntimeStatus(loadingStatus)

    void Promise.resolve().then(async () => {
      const loaded: RebookExtension[] = []
      const nextStatus: DemoExtensionRuntimeStatus = {}
      for (const entry of entries) {
        if (!entry.installUrl) {
          nextStatus[entry.manifest.id] = {
            state: 'error',
            message: 'No installUrl is configured for this extension.',
          }
          continue
        }
        try {
          const cached = extensionRuntimeCacheRef.current.get(entry.manifest.id)
          const extension = cached?.installUrl === entry.installUrl
            ? cached.extension
            : await loadDemoMarketplaceExtension(entry)
          extensionRuntimeCacheRef.current.set(entry.manifest.id, {
            installUrl: entry.installUrl,
            extension,
          })
          loaded.push(extension)
          nextStatus[entry.manifest.id] = {
            state: 'loaded',
            message: `Loaded runtime from ${entry.installUrl}.`,
          }
        } catch (error) {
          nextStatus[entry.manifest.id] = {
            state: 'error',
            message: `Runtime load failed: ${formatError(error)}`,
          }
          appendDebug('marketplace extension load failed', {
            id: entry.manifest.id,
            installUrl: entry.installUrl,
            error: formatError(error),
          })
        }
      }
      if (!cancelled) {
        setMarketplaceRuntimeExtensions(loaded)
        setExtensionRuntimeStatus(nextStatus)
      }
    })

    return () => {
      cancelled = true
    }
  }, [appendDebug, runtimeExtensionLoadKey])

  const scanReflowFigures = useCallback(() => ({
    ...createReflowDebugSnapshot(viewerRef.current),
    location: summarizeLocation(readerRef.current?.getLocation?.()),
  }), [])

  const logReflowFigureScan = useCallback(() => {
    const snapshot = scanReflowFigures()
    pushDebugEntry('reflow figure scan', summarizeReflowDebugSnapshot(snapshot))
    return snapshot
  }, [pushDebugEntry, scanReflowFigures])

  const copyReflowFigureScan = useCallback(async () => {
    const snapshot = scanReflowFigures()
    await navigator.clipboard?.writeText(safeStringify(snapshot))
    pushDebugEntry('reflow figure scan copied', summarizeReflowDebugSnapshot(snapshot))
    return snapshot
  }, [pushDebugEntry, scanReflowFigures])

  const jumpToDebugBlock = useCallback(async (blockId: string) => {
    const reader = readerRef.current
    const index = reader?.getLocation?.()?.index
    if (!reader || typeof index !== 'number' || !blockId.trim()) return
    await reader.goTo(`${index}#${blockId.trim()}`)
  }, [])

  const runDebugNavigation = useCallback(async (action: () => Promise<void> | void) => {
    await action()
    await waitForDebugRender()
    const snapshot = scanReflowFigures()
    pushDebugEntry('reflow debug navigation', summarizeReflowDebugSnapshot(snapshot))
    return snapshot
  }, [pushDebugEntry, scanReflowFigures])

  const debugNextPage = useCallback(() => runDebugNavigation(async () => {
    await readerRef.current?.next?.()
  }), [runDebugNavigation])

  const debugPrevPage = useCallback(() => runDebugNavigation(async () => {
    await readerRef.current?.prev?.()
  }), [runDebugNavigation])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
      if (settingsOpen) return
      if (!bookRef.current || !readerRef.current) return
      if (isEditableKeyboardTarget(event.target)) return

      const direction = getKeyboardPageDirection(event)
      if (!direction) return

      event.preventDefault()
      const reader = readerRef.current
      const navigation = direction === 'next' ? reader.next?.() : reader.prev?.()
      void Promise.resolve(navigation).catch((error: unknown) => {
        appendDebug('keyboard navigation failed', {
          key: event.key,
          direction,
          error: formatError(error),
        })
      })
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [appendDebug, settingsOpen])

  const debugGoTo = useCallback((target: string | number) => runDebugNavigation(async () => {
    await readerRef.current?.goTo?.(target)
  }), [runDebugNavigation])

  const debugRefresh = useCallback(() => runDebugNavigation(async () => {
    await readerRef.current?.refresh?.()
  }), [runDebugNavigation])

  const debugJumpToBlock = useCallback((blockId: string) => runDebugNavigation(async () => {
    await jumpToDebugBlock(blockId)
  }), [jumpToDebugBlock, runDebugNavigation])

  const debugScanPages = useCallback(async (options: ReflowDebugScanOptions = {}) => {
    const reader = readerRef.current
    const pages = Math.max(1, Math.min(80, Math.floor(options.pages ?? 12)))
    const direction = options.direction ?? 'next'
    const snapshots: ReflowDebugSnapshot[] = []

    for (let index = 0; index < pages; index += 1) {
      const snapshot = scanReflowFigures()
      snapshots.push(snapshot)
      if (options.stopOnIssue && snapshot.issues.length > 0) break
      if (index === pages - 1 || !reader) break
      if (direction === 'prev') await reader.prev?.()
      else await reader.next?.()
      await waitForDebugRender()
    }

    pushDebugEntry('reflow debug page scan', {
      pages: snapshots.length,
      direction,
      issues: snapshots.flatMap(snapshot => summarizeReflowDebugSnapshot(snapshot).issues),
      last: summarizeReflowDebugSnapshot(snapshots[snapshots.length - 1]!),
    })
    return snapshots
  }, [pushDebugEntry, scanReflowFigures])

  const debugFindFigureIssues = useCallback((pages = 20) =>
    debugScanPages({ pages, direction: 'next', stopOnIssue: true }), [debugScanPages])

  const getDebugSections = useCallback(() => summarizeDebugSections(bookRef.current), [])

  const getDebugHelp = useCallback(() => ({
    global: 'window.rebookDebug',
    aliases: ['window.__rebookDebug', 'window.rebookDebug'],
    examples: [
      'await rebookDebug.go(11)',
      "await rebookDebug.block('image-116')",
      'rebookDebug.figures().issues',
      'await rebookDebug.scan({ pages: 20, stopOnIssue: true })',
      'rebookDebug.sections()',
    ],
    methods: [
      'help',
      'figures',
      'go',
      'next',
      'prev',
      'refresh',
      'scan',
      'find',
      'block',
      'sections',
      'location',
    ],
  }), [])

  if (typeof window !== 'undefined') {
    const debugTools: RebookDebugTools = {
      version: '2026-06-20',
      help: getDebugHelp,
      figures: scanReflowFigures,
      scanFigures: scanReflowFigures,
      logFigures: logReflowFigureScan,
      copyFigures: copyReflowFigureScan,
      go: debugGoTo,
      next: debugNextPage,
      prev: debugPrevPage,
      goTo: debugGoTo,
      refresh: debugRefresh,
      scan: debugScanPages,
      scanPages: debugScanPages,
      find: debugFindFigureIssues,
      findFigureIssues: debugFindFigureIssues,
      block: debugJumpToBlock,
      sections: getDebugSections,
      jumpToBlock: jumpToDebugBlock,
      location: () => readerRef.current?.getLocation?.() ?? null,
      getLocation: () => readerRef.current?.getLocation?.() ?? null,
      reader: () => readerRef.current,
      book: () => bookRef.current,
    }
    const debugWindow = window as Window & {
      __rebookDebug?: RebookDebugTools
      rebookDebug?: RebookDebugTools
    }
    debugWindow.__rebookDebug = debugTools
    debugWindow.rebookDebug = debugTools
    installRebookDebugBridge(debugTools)
  }

  const createModel = useCallback((apiKey: string, baseURL: string, model: string) => {
    if (!apiKey.trim()) return null
    const openaiOptions: { apiKey: string; baseURL?: string } = { apiKey: apiKey.trim() }
    if (baseURL.trim()) openaiOptions.baseURL = baseURL.trim()
    return createOpenAI(openaiOptions).chat(model.trim() || 'gpt-4o-mini')
  }, [])

  const buildPlugins = useCallback((cfg: DemoConfig) => {
    const plugins: any[] = []

    if (cfg.translate) {
      const onUpdate = ({ sectionIndex }: { sectionIndex: number }) => {
        if (readerRef.current?.getLocation?.()?.index === sectionIndex) {
          void readerRef.current?.refresh?.()
        }
      }
      if (cfg.professionalTranslation) {
        if (cfg.professionalServiceBaseUrl.trim() && cfg.professionalBookId.trim()) {
          plugins.push(createProfessionalTranslationExtension({
            serviceBaseUrl: getRebookServiceOrigin(cfg.professionalServiceBaseUrl),
            bookId: cfg.professionalBookId.trim(),
            targetLanguage: 'zh-CN',
            mode: () => configRef.current.translateMode,
            prefetchPages: () => Number(configRef.current.prefetchPages) || 0,
            onUpdate,
            onStatus: status => appendDebug('translation status', status),
            pipeline: {
              audience: 'general demo readers',
              style: 'Faithful, precise, publication-quality Chinese.',
            },
          }))
        }
      } else if (cfg.apiKey.trim()) {
        const model = createModel(cfg.apiKey, cfg.baseURL, cfg.model)
        if (model) {
          plugins.push(createTranslationExtension({
            model,
            targetLanguage: 'zh-CN',
            mode: () => configRef.current.translateMode,
            translateTOC: () => configRef.current.translateTOC,
            prefetchPages: () => Number(configRef.current.prefetchPages) || 0,
            onTOCUpdate: () => refreshTOC(),
            onUpdate,
          }))
        }
      }
    }

    if (cfg.tts) {
      const ttsOptions: any = {
        endpoint: cfg.ttsEndpoint.trim() || defaultConfig.ttsEndpoint,
        provider: cfg.ttsProvider.trim() || undefined,
        soundEffectProvider: cfg.ttsSoundEffectProvider.trim() || defaultConfig.ttsSoundEffectProvider,
        voice: getTTSVoiceValue(cfg),
        speed: Number(cfg.ttsSpeed) || undefined,
        maxSegmentChars: Number(cfg.ttsSegmentChars) || Number(defaultConfig.ttsSegmentChars),
        player: ttsPlayer,
      }
      if (cfg.ttsMultiSpeaker) {
        const model = createModel(cfg.ttsAIAPIKey, cfg.ttsAIBaseURL, cfg.ttsModel)
        if (model) {
          ttsOptions.model = model
          ttsOptions.multiSpeaker = true
          ttsOptions.speakerAnalysis = {
            onLog: (event: unknown) => appendDebug('tts llm', event),
          }
          ttsOptions.voiceProfile = createTTSVoiceProfile(cfg)
        }
      }
      plugins.push(createTTSExtension(ttsOptions))
    }

    if (cfg.chat) {
      const model = createModel(cfg.chatAPIKey, cfg.chatBaseURL, cfg.chatModel)
      if (model) {
        plugins.push(createAIChatExtension({
          model,
          system: () => buildStoryMemorySystemPrompt(configRef.current),
          extraTools: () => createStoryMemoryTools(
            readStoryMemoryToolConfig(configRef.current),
            event => appendDebug('story memory tool', event),
          ),
          maxContentChars: () => Number(configRef.current.chatMaxContentChars) || Number(defaultConfig.chatMaxContentChars),
          maxContextChars: () => Math.max(Number(configRef.current.chatMaxContentChars) || Number(defaultConfig.chatMaxContentChars), 20000),
          onDocumentEdit: event => {
            appendDebug('ai chat document edit', {
              type: event.type,
              unitIndexes: event.unitIndexes,
              edits: event.edits.length,
              version: event.version,
            })
            const reader = readerRef.current
            const currentIndex = reader?.getLocation?.()?.index
            if (reader && typeof currentIndex === 'number' && event.unitIndexes.includes(currentIndex)) {
              void reader.refresh?.().catch((error: unknown) => appendDebug('ai chat document edit refresh failed', formatError(error)))
            }
          },
        }))
      }
    }

    plugins.push(...marketplaceRuntimeExtensions)
    return plugins
  }, [appendDebug, createModel, marketplaceRuntimeExtensions, ttsPlayer])

  const createDemoReader = useCallback((cfg: DemoConfig) => {
    if (!viewerRef.current) return null
    return createReader({
      container: viewerRef.current,
      layout: cfg.layout,
      maxColumnCount: Number(cfg.spread),
      parserOptions,
      plugins: buildPlugins(cfg),
      fixedPainter: cfg.fixedPainter,
      styles: getReaderStyles(cfg, appTheme),
    })
  }, [buildPlugins, appTheme])

  const wireReaderEvents = useCallback((reader: any) => {
    reader.on('relocate', (event: any) => {
      setLocation(event)
      refreshTOC(reader, event)
      scheduleShelfProgress(event)
      appendDebug('relocate', summarizeLocation(event))
    })
    reader.on('link', (event: any) => {
      if (event.external) window.open(event.href, '_blank', 'noopener,noreferrer')
      else void reader.goTo(event.href).catch((error: unknown) => appendDebug('link navigation failed', formatError(error)))
    })
    reader.on('block-window', (event: any) => appendDebug('block window', event))
  }, [appendDebug, scheduleShelfProgress])

  const resetReader = useCallback(async (nextConfig: DemoConfig, reopen = currentFileRef.current) => {
    const resetId = ++readerResetIdRef.current
    await ensureReaderFontsLoaded(nextConfig)
    if (resetId !== readerResetIdRef.current) return
    const previous = readerRef.current
    if (previous) previous.destroy()
    if (viewerRef.current) viewerRef.current.textContent = ''

    setRebookDebug(nextConfig.debug)
    const nextReader = createDemoReader(nextConfig)
    if (!nextReader) return
    readerRef.current = nextReader
    wireReaderEvents(nextReader)

    if (reopen) await openFileWithReader(reopen, nextReader, { preserveFile: true })
  }, [createDemoReader, wireReaderEvents])

  useEffect(() => {
    void resetReader(config, null)
    return () => {
      readerRef.current?.destroy?.()
      ttsPlayer.destroy?.()
    }
  }, [])

  useEffect(() => {
    if (!readerRef.current) return
    void resetReader(config)
  }, [marketplaceRuntimeExtensions])

  useEffect(() => {
    document.title = `${bookTitle} - rebook`
  }, [bookTitle])

  useEffect(() => {
    const reader = readerRef.current
    const currentBook = bookRef.current
    if (!reader || !currentBook) {
      setChatReferenceOptions([])
      return
    }

    let cancelled = false
    void buildChatReferenceOptions(reader, currentBook)
      .then(options => {
        if (!cancelled) setChatReferenceOptions(options)
      })
      .catch(error => {
        appendDebug('chat reference options failed', formatError(error))
        if (!cancelled) setChatReferenceOptions([])
      })

    return () => {
      cancelled = true
    }
  }, [appendDebug, book, location])

  const openFileWithReader = async (file: File, targetReader = readerRef.current, options: { preserveFile?: boolean } = {}) => {
    if (!targetReader) return
    const previousFile = currentFileRef.current
    setBusy(true)
    setStatus(`Opening ${file.name}...`)
    try {
      const started = performance.now()
      const openedBook = await targetReader.open(file)
      if (!options.preserveFile) currentFileRef.current = file
      bookRef.current = openedBook
      setBook(openedBook)
      const parsedTitle = formatLanguageMap(openedBook.metadata?.title).trim()
      const title = parsedTitle && parsedTitle !== file.name ? parsedTitle : titleFromBookFileName(file.name)
      const author = formatBookContributors(openedBook.metadata?.author)
      let cover: Blob | null = null
      try {
        cover = await extractBookCover(openedBook)
      } catch (error) {
        appendDebug('cover extraction failed', formatError(error))
      }
      setBookTitle(title)
      setBookAuthor(author)
      replaceBookCover(cover)
      setLibraryItem(current => current ? { ...current, title, author: author || null } : current)
      if (!options.preserveFile && libraryBookId && isLocalBookId(libraryBookId)) {
        await updateLocalBookMetadata(libraryBookId, {
          title,
          author: author || null,
          ...(cover ? { cover } : {}),
        })
      }
      setChatMessages([])
      setSearchResults([])
      setSearchStatus('请输入搜索内容。')
      refreshTOC(targetReader)
      await targetReader.goTo(0)
      setStatus(`Opened ${file.name} in ${formatMs(performance.now() - started)}.`)
      setTTSStatus(openedBook.tts ? 'TTS ready.' : 'TTS plugin disabled.')
      appendDebug('book opened', {
        name: file.name,
        sections: openedBook.sections.length,
        title,
        author,
        cover: Boolean(cover),
        toc: flattenTOCItems(openedBook.toc ?? []).length,
      })
    } catch (error) {
      const detail = error instanceof UnsupportedFormatError
        ? 'Unsupported file format. Please open an EPUB, MOBI, FB2, CBZ, or PDF file.'
        : error instanceof EBookError
          ? `Error (${error.code}): ${error.message}`
          : formatError(error)
      setStatus(`Failed to open file: ${detail}`)
      if (!options.preserveFile) currentFileRef.current = previousFile
      if (!bookRef.current) setBook(null)
      appendDebug('open failed', detail)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!libraryBookId) return
    const controller = new AbortController()
    let cancelled = false

    void Promise.resolve().then(async () => {
      setBusy(true)
      setStatus('正在从书架加载书籍…')
      try {
        let item: ShelfItem
        let file: File
        if (isLocalBookId(libraryBookId)) {
          const localBook = await getLocalBook(libraryBookId)
          if (!localBook) throw new Error('本地书籍不存在，可能已被浏览器清理')
          item = localBook.item
          file = localBook.file
        } else {
          item = await apiRequest<ShelfItem>(`/shelf/items/${libraryBookId}`)
          const response = await apiFetch(`/shelf/items/${libraryBookId}/file`, {
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const blob = await response.blob()
          file = new File(
            [blob],
            item.fileName || item.sourceFileName || `${item.title}.${item.sourceType}`,
            { type: blob.type || 'application/octet-stream' },
          )
        }
        if (cancelled) return
        setLibraryItem(item)

        const nextConfig = {
          ...configRef.current,
          professionalBookId: item.id,
        }
        configRef.current = nextConfig
        setConfig(nextConfig)
        setDraftConfig(nextConfig)
        await resetReader(nextConfig, null)
        await openFileWithReader(file, readerRef.current)
        const unitIndex = item.locator?.unitIndex
        if (typeof unitIndex === 'number') {
          await readerRef.current?.goTo?.(unitIndex)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setStatus(`书架书籍加载失败：${formatError(error)}`)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [libraryBookId])

  const refreshTOC = (reader = readerRef.current, currentLocation = reader?.getLocation?.()) => {
    if (!reader) return
    setTocItems(reader.getTOCViewItems({ location: currentLocation }))
  }

  const applyConfig = async () => {
    const next = { ...draftConfig, chatPanelWidth: String(chatPanelWidth) }
    setConfig(next)
    configRef.current = next
    saveConfig(next)
    setSettingsOpen(false)
    await resetReader(next)
  }

  const closeSettings = () => {
    setSettingsOpen(false)
    setDraftConfig(config)
    void ensureReaderFontsLoaded(config).then(() => {
      readerRef.current?.setStyles?.(getReaderStyles(config, appTheme))
    })
  }

  const uploadCurrentBookForStoryMemory = async (uploadConfig: DemoConfig) => {
    const file = currentFileRef.current
    if (!file) {
      const message = 'Open a local book file before uploading it to rebook-service.'
      setStoryUploadStatus(message)
      throw new Error(message)
    }
    const serviceBaseUrl = uploadConfig.professionalServiceBaseUrl.trim()
    if (!serviceBaseUrl) {
      const message = 'Fill Story service URL before uploading.'
      setStoryUploadStatus(message)
      throw new Error(message)
    }

    setStoryUploadBusy(true)
    setStoryUploadStatus(`Uploading ${file.name}...`)
    try {
      const form = new FormData()
      form.append('file', file, file.name)
      if (bookTitle && bookTitle !== 'rebook') form.append('title', bookTitle)
      const uploadUrl = createRebookApiUrl(serviceBaseUrl, '/books/upload')
      const response = uploadUrl === apiUrl('/books/upload')
        ? await apiFetch('/books/upload', { method: 'POST', body: form })
        : await fetch(uploadUrl, {
            method: 'POST',
            body: form,
            credentials: 'include',
          })
      const text = await response.text()
      const data = parseStoryMemoryResponse(text)
      if (!response.ok) {
        throw new Error(storyMemoryErrorText(data, text) || `HTTP ${response.status}`)
      }
      if (!isRecord(data) || typeof data.id !== 'string') {
        throw new Error('Upload succeeded but response did not include a book id.')
      }
      setStoryUploadStatus(`Uploaded. Book ID: ${data.id}. Apply settings to enable story tools.`)
      appendDebug('story memory upload', { bookId: data.id, title: data.title })
      return {
        bookId: data.id,
        title: typeof data.title === 'string' ? data.title : undefined,
      }
    } catch (error) {
      const message = `Upload failed: ${formatError(error)}`
      setStoryUploadStatus(message)
      appendDebug('story memory upload failed', message)
      throw error
    } finally {
      setStoryUploadBusy(false)
    }
  }

  const runSearch = async (rawQuery = searchQuery) => {
    const reader = readerRef.current
    if (!reader || !bookRef.current) {
      setSearchStatus('书籍加载后即可搜索。')
      return
    }
    const query = rawQuery.trim()
    if (!query) {
      setSearchStatus('请输入搜索内容。')
      return
    }
    setSearchStatus('正在搜索…')
    reader.clearMarks?.('search')
    const results = await reader.search(query, {
      scope: searchScope === 'unit' ? 'unit' : 'book',
      unitIndex: location?.index ?? 0,
      maxResults: MAX_SEARCH_RESULTS,
      contextChars: 96,
    })
    setSearchResults(results)
    setSearchStatus(results.length ? `找到 ${results.length} 个结果` : '没有找到匹配内容。')
  }

  const goToSearchResult = async (item: SearchItem) => {
    const reader = readerRef.current
    if (!reader?.canGoTo?.(item.unitIndex)) {
      setStatus('Trial limit reached.')
      return
    }
    const target = item.blockId ? `${item.unitIndex}#${item.blockId}` : item.unitIndex
    await reader.goTo(target)
    reader.clearMarks?.('search')
    if (item.blockId && item.sectionIndex != null) {
      reader.setMark?.({
        id: 'search-current',
        kind: 'search',
        location: {
          start: { type: 'reflowable', sectionIndex: item.sectionIndex, blockId: item.blockId, offset: item.start },
          end: { type: 'reflowable', sectionIndex: item.sectionIndex, blockId: item.blockId, offset: item.end },
        },
        className: 'rebook-search-current',
      })
    }
  }

  const sendChatMessage = async () => {
    const rawContent = chatInput.trim()
    const commandResult = resolveChatCommand(rawContent)
    const content = buildChatMessageContentWithReferences(commandResult?.prompt ?? rawContent, chatReferences)
    const attachments = chatAttachments
    const references = chatReferences
    const aiChat = bookRef.current?.aiChat
    if ((!rawContent && !attachments.length && !references.length) || chatBusy) return
    if (commandResult?.error && !attachments.length) {
      const nextMessages: ChatMessage[] = [
        ...chatMessages.filter(message => !message.pending),
        { role: 'user', content: rawContent, displayContent: rawContent, references },
        { role: 'assistant', content: commandResult.error },
      ]
      setChatMessages(nextMessages)
      setChatInput(commandResult.insertText ?? rawContent)
      return
    }
    if (!aiChat) {
      setChatMessages(messages => [...messages, {
        role: 'assistant',
        content: config.chat ? '请先在设置中填写 AI Chat API Key 并重新应用配置。' : '请先在设置中启用 AI Chat。',
      }])
      return
    }

    const nextMessages: ChatMessage[] = [
      ...chatMessages.filter(message => !message.pending),
      {
        role: 'user',
        content: content || '请分析这些图片。',
        displayContent: commandResult || references.length ? rawContent : undefined,
        attachments,
        references,
      },
    ]
    setChatMessages([...nextMessages, { role: 'assistant', content: '', pending: true }])
    setChatInput('')
    setChatAttachments([])
    setChatReferences([])
    setChatBusy(true)
    try {
      const current = getCurrentChatContext(readerRef.current, bookRef.current)
      const askOptions = {
        messages: nextMessages.map(toAIChatMessage),
        currentUnitIndex: current.unitIndex,
        current,
      }
      if (typeof aiChat.stream === 'function') {
        const stream = aiChat.stream(askOptions)
        let streamedText = ''
        for await (const chunk of stream.textStream) {
          streamedText += chunk
          setChatMessages([...nextMessages, { role: 'assistant', content: streamedText, pending: true }])
        }
        const response = await stream.response
        setChatMessages([...nextMessages, { role: 'assistant', content: response.text || streamedText || '(empty response)' }])
        appendDebug('ai chat response', {
          streamed: true,
          toolCalls: response.toolCalls?.length ?? 0,
          toolResults: response.toolResults?.length ?? 0,
          finishReason: response.finishReason,
          usage: response.usage,
        })
        return
      }
      const response = await aiChat.ask(askOptions)
      setChatMessages([...nextMessages, { role: 'assistant', content: response.text || '(empty response)' }])
      appendDebug('ai chat response', {
        streamed: false,
        toolCalls: response.toolCalls?.length ?? 0,
        toolResults: response.toolResults?.length ?? 0,
        finishReason: response.finishReason,
        usage: response.usage,
      })
    } catch (error) {
      setChatMessages([...nextMessages, { role: 'assistant', content: `Chat failed: ${formatError(error)}` }])
      appendDebug('ai chat failed', formatError(error))
    } finally {
      setChatBusy(false)
    }
  }

  const addChatImages = async (files: FileList | File[]) => {
    const images = Array.from(files).filter(file => file.type.startsWith('image/'))
    if (!images.length) return
    const attachments = await Promise.all(images.slice(0, 6).map(readChatImageAttachment))
    setChatAttachments(items => [...items, ...attachments].slice(0, 6))
  }

  const removeChatAttachment = (id: string) => {
    setChatAttachments(items => {
      const attachment = items.find(item => item.id === id)
      if (attachment) URL.revokeObjectURL(attachment.previewUrl)
      return items.filter(item => item.id !== id)
    })
  }

  const addChatReference = (reference: ChatReference) => {
    setChatReferences(items => items.some(item => item.id === reference.id) ? items : [...items, reference].slice(0, 8))
  }

  const removeChatReference = (id: string) => {
    setChatReferences(items => items.filter(item => item.id !== id))
  }

  const openChatCitation = async (href: string) => {
    const citation = parseRebookJumpHref(href)
    if (!citation || !readerRef.current) return
    if (!readerRef.current.canGoTo?.(citation.unitIndex)) {
      setStatus('Trial limit reached.')
      return
    }
    const section = bookRef.current?.sections[citation.unitIndex]
    await readerRef.current.goTo(citation.blockId && section ? `${citation.unitIndex}#${citation.blockId}` : citation.unitIndex)
    readerRef.current.clearMarks?.('citation')
    if (citation.blockId && section) {
      readerRef.current.setMark?.({
        id: 'ai-chat-citation',
        kind: 'citation',
        location: {
          type: 'reflowable',
          sectionIndex: citation.unitIndex,
          blockId: citation.blockId,
        },
      })
    }
  }

  const playTTS = async () => {
    const currentBook = bookRef.current
    if (!currentBook?.tts || !readerRef.current) {
      setTTSStatus('Enable TTS and apply settings first.')
      return
    }
    stopTTS()
    const abortController = new AbortController()
    ttsAbortRef.current = abortController
    const cfg = configRef.current
    const sectionIndex = readerRef.current.getLocation?.()?.index ?? 0
    try {
      setTTSStatus(`Preparing section ${sectionIndex + 1} audio...`)
      const prefetchOptions: any = {
        voice: getTTSVoiceValue(cfg),
        maxSegmentChars: Number(cfg.ttsSegmentChars) || Number(defaultConfig.ttsSegmentChars),
        provider: cfg.ttsProvider.trim() || undefined,
        soundEffectProvider: cfg.ttsSoundEffectProvider.trim() || defaultConfig.ttsSoundEffectProvider,
        speed: Number(cfg.ttsSpeed) || undefined,
        concurrency: isMimoTTSProvider(cfg) ? 1 : 2,
      }
      if (cfg.ttsMultiSpeaker) {
        const model = createModel(cfg.ttsAIAPIKey, cfg.ttsAIBaseURL, cfg.ttsModel)
        if (!model) throw new Error('Multi voice TTS needs TTS AI API key.')
        prefetchOptions.model = model
        prefetchOptions.multiSpeaker = true
        prefetchOptions.speakerAnalysis = { onLog: (event: unknown) => appendDebug('tts llm', event) }
        prefetchOptions.voiceProfile = createTTSVoiceProfile(cfg)
      }
      const prefetch = await currentBook.tts.prefetchSection(sectionIndex, prefetchOptions)
      await currentBook.tts.playPrefetchedSection(prefetch, {
        signal: abortController.signal,
        preloadAhead: 3,
        onSegmentQueued: ({ index, total }: any) => setTTSStatus(`Queued ${index + 1}/${total}`),
        onSegmentStart: ({ index, total, segment }: any) => {
          setTTSStatus(`Playing ${index + 1}/${total}`)
          markTTSSegment(sectionIndex, segment)
        },
        onSegmentEnd: () => readerRef.current?.clearMarks?.('tts'),
        onSegmentError: ({ error }: any) => appendDebug('tts segment skipped', formatError(error)),
      })
      setTTSStatus('TTS finished.')
    } catch (error) {
      if (!abortController.signal.aborted) setTTSStatus(`TTS failed: ${formatError(error)}`)
    } finally {
      if (ttsAbortRef.current === abortController) ttsAbortRef.current = null
      readerRef.current?.clearMarks?.('tts')
    }
  }

  const stopTTS = () => {
    ttsAbortRef.current?.abort()
    ttsAbortRef.current = null
    bookRef.current?.tts?.stopPlayback?.()
    ttsPlayer.stop()
    readerRef.current?.clearMarks?.('tts')
    setTTSStatus(bookRef.current?.tts ? 'TTS stopped.' : 'TTS plugin disabled.')
  }

  const markTTSSegment = (sectionIndex: number, segment: any) => {
    if (!segment?.blockId) return
    readerRef.current?.setMark?.({
      id: 'tts-current',
      kind: 'tts',
      location: {
        start: { type: 'reflowable', sectionIndex, blockId: segment.blockId, offset: segment.startOffset ?? 0 },
        end: { type: 'reflowable', sectionIndex, blockId: segment.blockId, offset: segment.endOffset ?? Math.max(1, segment.text?.length ?? 1) },
      },
      className: 'rebook-tts-current',
    })
  }

  return (
    <div
      className="reader-shell flex h-full min-h-0 flex-col"
      data-reader-theme={appTheme}
    >
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <>
            <button
              type="button"
              className={`absolute inset-0 z-60 bg-overlay transition-opacity ${sidebarPinned ? 'lg:hidden' : ''}`}
              aria-label="关闭侧边栏"
              onClick={() => setSidebarOpen(false)}
            />
            <ReaderSidebar
              items={tocItems}
              view={sidebarView}
              pinned={sidebarPinned}
              bookTitle={bookTitle || libraryItem?.title || '正在加载…'}
              bookAuthor={bookAuthor || libraryItem?.author || ''}
              bookFormat={libraryItem?.sourceType || ''}
              coverUrl={bookCoverUrl || (libraryItem?.coverUrl ? assetUrl(libraryItem.coverUrl) : null)}
              searchInputRef={searchInputRef}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchScope={searchScope}
              setSearchScope={setSearchScope}
              searchStatus={searchStatus}
              searchResults={searchResults}
              onSetView={setSidebarView}
              onClose={() => setSidebarOpen(false)}
              onTogglePinned={() => setSidebarPinned(value => !value)}
              onRunSearch={query => void runSearch(query)}
              onClearSearch={() => {
                readerRef.current?.clearMarks?.('search')
                setSearchQuery('')
                setSearchResults([])
                setSearchStatus(bookRef.current ? '请输入搜索内容。' : '书籍加载后即可搜索。')
              }}
              onSearchNavigate={item => {
                void goToSearchResult(item)
                if (window.innerWidth < 1024) setSidebarOpen(false)
              }}
              onNavigate={target => {
                void readerRef.current?.goTo?.(target)
                if (window.innerWidth < 1024) setSidebarOpen(false)
              }}
            />
          </>
        )}

        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface p-0 [@media(hover:none)]:pt-11">
          <Header
            busy={busy}
            bookTitle={bookTitle}
            sidebarOpen={sidebarOpen}
            activePanel={activePanel}
            chatEnabled={config.chat}
            authenticated={authenticated}
            accountLabel={accountLabel}
            onExit={onExit}
            onLogin={onLogin}
            onLogout={onLogout}
            onToggleSidebar={() => setSidebarOpen(value => !value)}
            onOpenSettings={() => {
              setDraftConfig(config)
              setSettingsSection('font')
              setSettingsOpen(true)
            }}
            onTogglePanel={panel => setActivePanel(activePanel === panel ? null : panel)}
          />
          <div className="relative min-h-0 flex-1 overflow-hidden bg-surface">
            <div ref={viewerRef} id="viewer" />
            {!book && (
              <div className="absolute inset-0 grid place-items-center bg-surface/92 p-8">
                <div className="max-w-md text-center text-ui-md text-muted">
                  {busy ? <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-accent" /> : null}
                  {status}
                </div>
              </div>
            )}
          </div>
          <ProgressBar value={location?.totalFraction ?? 0} />
        </section>

        {activePanel && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-60 bg-overlay lg:hidden"
              aria-label="Close panel"
              onClick={() => setActivePanel(null)}
            />
            <RightPanel
              panel={activePanel}
              width={chatPanelWidth}
              onClearChat={() => {
                setChatMessages(messages => {
                  revokeChatAttachmentURLs(messages.flatMap(message => message.attachments ?? []))
                  return []
                })
                setChatReferences([])
                setChatAttachments(items => {
                  revokeChatAttachmentURLs(items)
                  return []
                })
              }}
              setWidth={value => {
                const width = clampPanelWidth(value)
                setChatPanelWidth(width)
                const next = { ...configRef.current, chatPanelWidth: String(width) }
                configRef.current = next
                setConfig(next)
                saveConfig(next)
              }}
              onClose={() => setActivePanel(null)}
            >
              <ChatPanel
                messages={chatMessages}
                input={chatInput}
                attachments={chatAttachments}
                references={chatReferences}
                referenceOptions={chatReferenceOptions}
                busy={chatBusy}
                setInput={setChatInput}
                onAddImages={files => void addChatImages(files)}
                onRemoveAttachment={removeChatAttachment}
                onAddReference={addChatReference}
                onRemoveReference={removeChatReference}
                onSend={() => void sendChatMessage()}
                onCitation={href => void openChatCitation(href)}
              />
            </RightPanel>
          </>
        )}
      </main>

      <Footer
        ttsEnabled={config.tts}
        ttsStatus={ttsStatus}
        onPlayTTS={() => void playTTS()}
        onStopTTS={stopTTS}
      />

      {settingsOpen && (
        <SettingsDialog
          section={settingsSection}
          setSection={setSettingsSection}
          config={draftConfig}
          setConfig={setDraftConfig}
          extensionRuntimeStatus={extensionRuntimeStatus}
          currentBookFileName={currentFileRef.current?.name}
          storyUploadBusy={storyUploadBusy}
          storyUploadStatus={storyUploadStatus}
          onUploadCurrentBook={uploadCurrentBookForStoryMemory}
          onClose={closeSettings}
          onApply={() => void applyConfig()}
        />
      )}
    </div>
  )
}

function Header(props: {
  busy: boolean
  bookTitle: string
  sidebarOpen: boolean
  activePanel: Panel
  chatEnabled: boolean
  authenticated: boolean
  accountLabel: string
  onExit?: () => void
  onLogin?: () => void
  onLogout?: () => void
  onToggleSidebar(): void
  onOpenSettings(): void
  onTogglePanel(panel: Panel): void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [hoverCapable, setHoverCapable] = useState(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches)

  const reveal = useCallback(() => {
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
    setRevealed(true)
  }, [])

  const scheduleHide = useCallback(() => {
    if (!hoverCapable || menuOpen) return
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setRevealed(false), 500)
  }, [hoverCapable, menuOpen])

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)')
    const update = () => setHoverCapable(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => () => {
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const visible = !hoverCapable || revealed || menuOpen

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 h-11">
      <div
        className="pointer-events-auto absolute inset-x-0 top-0 h-7"
        aria-hidden="true"
        onPointerEnter={reveal}
      />
      <header
        className={`absolute inset-x-0 top-0 grid h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-visible border-b border-line bg-surface/92 px-3 backdrop-blur-xl transition duration-200 motion-reduce:transition-none ${
          visible ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0'
        }`}
        onPointerEnter={reveal}
        onPointerLeave={scheduleHide}
        onFocus={reveal}
        onBlur={scheduleHide}
      >
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          className={iconButtonClass}
          type="button"
          onClick={props.onToggleSidebar}
          title={props.sidebarOpen ? '收起侧边栏' : '打开侧边栏'}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>
      <div className="min-w-0 text-center">
        <div className="flex items-center justify-center gap-2 truncate text-ui-md font-semibold text-ink">
          {props.busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
          <span className="truncate">{props.bookTitle || (props.busy ? '正在加载…' : '阅读器')}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {props.chatEnabled ? (
          <button className={iconButtonClass} type="button" onClick={() => props.onTogglePanel('chat')} title="Chat">
            <MessageSquareText className="h-4 w-4" />
          </button>
        ) : null}
        <div className="relative" ref={menuRef}>
          <button
            className={panelButtonClass(menuOpen)}
            type="button"
            title="Menu"
            aria-label="打开菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          >
            <Menu className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-11 z-80 w-60 rounded-xl border border-line bg-surface-raised p-1.5 text-left shadow-menu animate-pop motion-reduce:animate-none">
              {props.authenticated ? (
                <div className="mb-1 flex items-center gap-2.5 border-b border-line px-3 py-2.5">
                  <UserRound className="h-4 w-4 shrink-0 text-muted" />
                  <span className="truncate text-ui-sm text-muted-strong">{props.accountLabel}</span>
                </div>
              ) : null}
              {props.onExit ? (
                <ReaderMenuAction
                  icon={<ArrowLeft className="h-4 w-4" />}
                  label="返回书架"
                  onClick={() => {
                    setMenuOpen(false)
                    props.onExit?.()
                  }}
                />
              ) : null}
              <ReaderMenuAction
                icon={<Settings className="h-4 w-4" />}
                label="设置"
                onClick={() => {
                  setMenuOpen(false)
                  props.onOpenSettings()
                }}
              />
              {!props.authenticated && props.onLogin ? (
                <ReaderMenuAction
                  icon={<LogIn className="h-4 w-4" />}
                  label="登录"
                  onClick={() => {
                    setMenuOpen(false)
                    props.onLogin?.()
                  }}
                />
              ) : null}
              {props.authenticated && props.onLogout ? (
                <ReaderMenuAction
                  icon={<LogOut className="h-4 w-4" />}
                  label="退出登录"
                  onClick={() => {
                    setMenuOpen(false)
                    props.onLogout?.()
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {props.onExit ? (
          <button className={iconButtonClass} type="button" onClick={props.onExit} title="返回书架">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      </header>
    </div>
  )
}

function ReaderMenuAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick(): void
}) {
  return (
    <button
      className={menuRowClass}
      type="button"
      onClick={onClick}
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  )
}

function ReaderSidebar({
  items,
  view,
  pinned,
  bookTitle,
  bookAuthor,
  bookFormat,
  coverUrl,
  searchInputRef,
  searchQuery,
  setSearchQuery,
  searchScope,
  setSearchScope,
  searchStatus,
  searchResults,
  onSetView,
  onClose,
  onTogglePinned,
  onRunSearch,
  onClearSearch,
  onSearchNavigate,
  onNavigate,
}: {
  items: readonly DemoTOCItem[]
  view: SidebarView
  pinned: boolean
  bookTitle: string
  bookAuthor: string
  bookFormat: string
  coverUrl: string | null
  searchInputRef: RefObject<HTMLInputElement | null>
  searchQuery: string
  setSearchQuery(value: string): void
  searchScope: 'unit' | 'book'
  setSearchScope(value: 'unit' | 'book'): void
  searchStatus: string
  searchResults: SearchItem[]
  onSetView(view: SidebarView): void
  onClose(): void
  onTogglePinned(): void
  onRunSearch(query?: string): void
  onClearSearch(): void
  onSearchNavigate(item: SearchItem): void
  onNavigate(target: string): void
}) {
  const activePath = useMemo(() => findActiveTOCPath(items), [items])
  const activePathKey = activePath.join('\u0000')
  const activeBranchIds = useMemo(() => new Set(activePath), [activePathKey])
  const lastAutoExpandedPathKeyRef = useRef<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    const validIds = collectTOCItemIds(items)
    const shouldAutoExpandActivePath = Boolean(activePathKey) && lastAutoExpandedPathKeyRef.current !== activePathKey
    if (shouldAutoExpandActivePath) lastAutoExpandedPathKeyRef.current = activePathKey
    setExpandedIds(current => {
      const next = new Set<string>()
      let changed = false
      for (const id of current) {
        if (validIds.has(id)) next.add(id)
        else changed = true
      }
      if (shouldAutoExpandActivePath) {
        for (const id of activePath) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        }
      }
      return changed ? next : current
    })
  }, [items, activePathKey])

  const toggleItem = useCallback((id: string) => {
    setExpandedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <aside className={`absolute inset-y-0 left-0 z-70 flex w-60 shrink-0 flex-col overflow-hidden border-r border-line bg-surface/92 shadow-dialog backdrop-blur-xl ${
      pinned ? 'lg:relative lg:z-auto lg:shadow-none' : 'lg:absolute lg:z-70'
    }`}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
        <button className={iconButtonClass} type="button" onClick={onClose} title="收起侧边栏">
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="flex-1" />
        <button
          className={sidebarToolButtonClass(view === 'search')}
          type="button"
          onClick={() => onSetView('search')}
          title="搜索"
          aria-pressed={view === 'search'}
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          className={sidebarToolButtonClass(view === 'toc')}
          type="button"
          onClick={() => onSetView('toc')}
          title="目录"
          aria-pressed={view === 'toc'}
        >
          <ListTree className="h-4 w-4" />
        </button>
        <button
          className={`${sidebarToolButtonClass(pinned)} hidden lg:inline-flex`}
          type="button"
          onClick={onTogglePinned}
          title={pinned ? '取消固定侧边栏' : '固定侧边栏'}
          aria-pressed={pinned}
        >
          {pinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
        </button>
      </div>

      {view === 'search' ? (
        <SearchPanel
          inputRef={searchInputRef}
          query={searchQuery}
          setQuery={setSearchQuery}
          scope={searchScope}
          setScope={setSearchScope}
          status={searchStatus}
          results={searchResults}
          bookSummary={(
            <SidebarBookSummary
              title={bookTitle}
              author={bookAuthor}
              format={bookFormat}
              coverUrl={coverUrl}
            />
          )}
          onRun={onRunSearch}
          onClear={onClearSearch}
          onNavigate={onSearchNavigate}
        />
      ) : (
        <>
          <SidebarBookSummary title={bookTitle} author={bookAuthor} format={bookFormat} coverUrl={coverUrl} />
          <div className="min-h-0 flex-1 overflow-auto border-t border-line py-2">
            {items.length ? (
              <TOCTree
                items={items}
                onNavigate={onNavigate}
                depth={0}
                expandedIds={expandedIds}
                activeBranchIds={activeBranchIds}
                onToggle={toggleItem}
              />
            ) : (
              <p className="px-4 py-5 text-ui-md text-muted">书籍加载后将在这里显示目录。</p>
            )}
          </div>
        </>
      )}
    </aside>
  )
}

function SidebarBookSummary({
  title,
  author,
  format,
  coverUrl,
}: {
  title: string
  author: string
  format: string
  coverUrl: string | null
}) {
  return (
    <div className="flex min-h-28 shrink-0 items-center gap-3 px-4 py-4">
      <div className="grid h-[4.5rem] w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-soft text-accent-text shadow-menu">
        {coverUrl ? (
          <img className="h-full w-full object-cover" src={coverUrl} alt="" />
        ) : (
          <BookOpen className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-ui-lg font-semibold text-ink">{title}</div>
        <div className="mt-1 truncate text-ui-md text-muted">{author || format.toUpperCase() || '电子书'}</div>
      </div>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted" title={`${title}${author ? ` · ${author}` : ''}`}>
        <Info className="h-4 w-4" />
      </span>
    </div>
  )
}

function TOCTree({
  items,
  onNavigate,
  depth,
  parentPath = '',
  expandedIds,
  activeBranchIds,
  onToggle,
}: {
  items: readonly DemoTOCItem[]
  onNavigate(target: string): void
  depth: number
  parentPath?: string
  expandedIds: ReadonlySet<string>
  activeBranchIds: ReadonlySet<string>
  onToggle(id: string): void
}) {
  return (
    <ul className={depth === 0 ? 'py-2' : ''}>
      {items.map((item, index) => {
        const itemPath = parentPath ? `${parentPath}/${index}` : `${index}`
        const itemId = getDemoTOCItemId(item, itemPath)
        const children = getDemoTOCItemChildren(item)
        const target = getDemoTOCItemTarget(item)
        const disabled = isDemoTOCItemDisabled(item) || !target
        const hasChildren = children.length > 0
        const expanded = hasChildren && expandedIds.has(itemId)
        const branchActive = activeBranchIds.has(itemId)
        return (
          <li key={itemId} data-toc-depth={depth} data-toc-expanded={hasChildren ? String(expanded) : undefined}>
            <div
              className={[
                'group mx-2 flex min-w-0 items-center gap-1 rounded-lg pr-2 text-ui-md transition-colors duration-150',
                isDemoTOCItemActive(item)
                  ? 'bg-accent-soft font-medium text-accent-text'
                  : branchActive
                    ? 'bg-surface-muted text-accent-text'
                    : 'text-ink-soft hover:bg-surface-muted hover:text-ink',
                disabled ? 'opacity-40' : '',
              ].join(' ')}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="grid h-8 w-6 shrink-0 place-items-center text-muted transition-colors duration-150 hover:text-ink"
                  onClick={() => onToggle(itemId)}
                  aria-expanded={expanded}
                  title={expanded ? 'Collapse section' : 'Expand section'}
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <span className="h-8 w-6 shrink-0" />
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => target ? onNavigate(target) : undefined}
                className={[
                  'min-w-0 flex-1 truncate py-2 text-left transition-colors duration-150',
                  disabled ? 'cursor-not-allowed' : '',
                ].join(' ')}
                title={getDemoTOCItemLabel(item)}
              >
                {getDemoTOCItemLabel(item)}
              </button>
            </div>
            {hasChildren && expanded ? (
              <TOCTree
                items={children}
                onNavigate={onNavigate}
                depth={depth + 1}
                parentPath={itemPath}
                expandedIds={expandedIds}
                activeBranchIds={activeBranchIds}
                onToggle={onToggle}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function findActiveTOCPath(items: readonly DemoTOCItem[], parents: readonly string[] = [], parentPath = ''): string[] {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const itemPath = parentPath ? `${parentPath}/${index}` : `${index}`
    const itemId = getDemoTOCItemId(item, itemPath)
    const path = [...parents, itemId]
    if (isDemoTOCItemActive(item)) return path
    const children = getDemoTOCItemChildren(item)
    const childPath = children.length ? findActiveTOCPath(children, path, itemPath) : []
    if (childPath.length) return childPath
  }
  return []
}

function collectTOCItemIds(items: readonly DemoTOCItem[]): Set<string> {
  const ids = new Set<string>()
  const visit = (tocItems: readonly DemoTOCItem[], parentPath = '') => {
    tocItems.forEach((item, index) => {
      const itemPath = parentPath ? `${parentPath}/${index}` : `${index}`
      ids.add(getDemoTOCItemId(item, itemPath))
      const children = getDemoTOCItemChildren(item)
      if (children.length) visit(children, itemPath)
    })
  }
  visit(items)
  return ids
}

function getDemoTOCItemChildren(item: DemoTOCItem): readonly DemoTOCItem[] {
  return item.children?.length ? item.children : item.subitems ?? []
}

function getDemoTOCItemId(item: DemoTOCItem, path: string): string {
  if (item.id) return item.id
  return `${path}:${getDemoTOCItemTarget(item) || getDemoTOCItemLabel(item)}`
}

function getDemoTOCItemTarget(item: DemoTOCItem): string {
  if (typeof item.target === 'string') return item.target
  if ('href' in item && typeof item.href === 'string') return item.href
  return ''
}

function getDemoTOCItemLabel(item: DemoTOCItem): string {
  return item.label || 'Untitled'
}

function isDemoTOCItemActive(item: DemoTOCItem): boolean {
  return item.active === true
}

function isDemoTOCItemDisabled(item: DemoTOCItem): boolean {
  return item.disabled === true
}

function RightPanel(props: {
  panel: Panel
  width: number
  setWidth(value: number): void
  onClose(): void
  onClearChat?: () => void
  children: React.ReactNode
}) {
  const dragRef = useRef<{ right: number } | null>(null)
  return (
    <aside
      className="absolute inset-y-0 right-0 z-70 max-w-[92vw] shrink-0 border-l border-line bg-surface/92 shadow-dialog backdrop-blur-xl lg:relative lg:z-auto lg:shadow-none"
      style={{ width: props.width }}
    >
      {props.panel === 'chat' && (
        <div
          className="absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize hover:bg-accent-soft lg:block"
          onPointerDown={event => {
            dragRef.current = { right: event.currentTarget.parentElement!.getBoundingClientRect().right }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            if (!dragRef.current) return
            props.setWidth(dragRef.current.right - event.clientX)
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
        />
      )}
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-ui-md font-semibold capitalize text-ink">{props.panel}</span>
          <div className="flex items-center gap-1">
            {props.panel === 'chat' && props.onClearChat ? (
              <button className={iconButtonClass} type="button" onClick={props.onClearChat} title="Clear chat">
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
            <button className={iconButtonClass} type="button" onClick={props.onClose} title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
      </div>
    </aside>
  )
}

function SearchPanel(props: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  setQuery(value: string): void
  scope: 'unit' | 'book'
  setScope(value: 'unit' | 'book'): void
  status: string
  results: SearchItem[]
  bookSummary: ReactNode
  onRun(query?: string): void
  onClear(): void
  onNavigate(item: SearchItem): void
}) {
  const scopeMenuRef = useRef<HTMLDivElement | null>(null)
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const groupedResults = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: Array<{ item: SearchItem; index: number }> }> = []
    const groupMap = new Map<string, (typeof groups)[number]>()
    props.results.forEach((item, index) => {
      const key = `${item.unitIndex}:${item.unitTitle || item.unitKind}`
      let group = groupMap.get(key)
      if (!group) {
        group = {
          key,
          label: item.unitTitle || `${item.unitKind} ${item.unitIndex + 1}`,
          items: [],
        }
        groupMap.set(key, group)
        groups.push(group)
      }
      group.items.push({ item, index })
    })
    return groups
  }, [props.results])

  useEffect(() => {
    if (!scopeMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!scopeMenuRef.current?.contains(event.target as Node)) setScopeMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScopeMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [scopeMenuOpen])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line p-2">
        <form
          className="flex items-stretch overflow-visible rounded-xl border border-line-strong bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-softer"
          onSubmit={event => {
            event.preventDefault()
            props.onRun(props.inputRef.current?.value ?? props.query)
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <Search className="h-5 w-5 shrink-0 text-muted" />
            <input
              ref={props.inputRef}
              className="h-11 min-w-0 flex-1 bg-transparent text-ui-md text-ink outline-none placeholder:text-muted"
              value={props.query}
              placeholder="搜索…"
              onChange={event => props.setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                props.onRun(event.currentTarget.value)
              }}
            />
            {props.query ? (
              <button className={roundIconButtonClass} type="button" onClick={props.onClear} title="清除搜索">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="relative border-l border-line" ref={scopeMenuRef}>
            <button
              className={`grid h-11 w-11 place-items-center rounded-r-xl text-muted-strong transition-colors duration-150 hover:bg-surface-muted ${scopeMenuOpen ? 'bg-surface-muted text-ink' : ''}`}
              type="button"
              title="搜索范围"
              aria-label="搜索范围"
              aria-expanded={scopeMenuOpen}
              onClick={() => setScopeMenuOpen(open => !open)}
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${scopeMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {scopeMenuOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-80 w-44 rounded-xl border border-line bg-surface-raised p-1.5 shadow-menu animate-pop motion-reduce:animate-none">
                {([
                  ['book', '全书'],
                  ['unit', '当前章节'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={menuRowClass}
                    type="button"
                    onClick={() => {
                      props.setScope(value)
                      setScopeMenuOpen(false)
                      props.inputRef.current?.focus()
                    }}
                  >
                    <span className="grid h-4 w-4 place-items-center">{props.scope === value ? <Check className="h-4 w-4" /> : null}</span>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </form>
      </div>
      {props.bookSummary}
      <div className="min-h-0 flex-1 overflow-auto border-t border-line px-3 py-3">
        {groupedResults.length ? groupedResults.map(group => (
          <section key={group.key} className="mb-5">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="truncate text-ui-md font-semibold text-ink">{group.label}</h3>
              <span className="ml-2 text-ui-sm text-muted">{group.items.length}</span>
            </div>
            <div className="space-y-2">
              {group.items.map(({ item, index }) => (
                <button
                  key={`${item.unitIndex}-${item.match}-${index}`}
                  type="button"
                  className="w-full rounded-xl border border-line bg-surface p-3 text-left text-ui-md text-ink-soft transition-colors duration-150 hover:border-accent hover:bg-accent-soft"
                  onClick={() => props.onNavigate(item)}
                >
                  <p className="line-clamp-4">{renderSearchExcerpt(item)}</p>
                </button>
              ))}
            </div>
          </section>
        )) : props.status === '正在搜索…' ? (
          <div className="grid min-h-28 place-items-center text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : props.status === '没有找到匹配内容。' ? (
          <div className="px-3 py-10 text-center text-ui-md text-muted">没有找到匹配内容</div>
        ) : null}
      </div>
    </div>
  )
}

function renderSearchExcerpt(item: SearchItem): ReactNode {
  return (
    <>
      {item.excerpt.startsWith('...') && <span>...</span>}
      <span>{item.before}</span>
      <mark className="rounded-lg bg-accent-soft px-0.5 font-semibold text-accent-text">{item.match}</mark>
      <span>{item.after}</span>
      {item.excerpt.endsWith('...') && <span>...</span>}
    </>
  )
}

function ChatPanel(props: {
  messages: ChatMessage[]
  input: string
  attachments: ChatAttachment[]
  references: ChatReference[]
  referenceOptions: ChatReference[]
  busy: boolean
  setInput(value: string): void
  onAddImages(files: FileList | File[]): void
  onRemoveAttachment(id: string): void
  onAddReference(reference: ChatReference): void
  onRemoveReference(id: string): void
  onSend(): void
  onCitation(href: string): void
}) {
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [cursorIndex, setCursorIndex] = useState(props.input.length)
  const referenceToken = useMemo(
    () => getChatReferenceToken(props.input, cursorIndex, props.references),
    [cursorIndex, props.input, props.references],
  )
  const referenceSuggestions = useMemo(
    () => referenceToken ? getChatReferenceSuggestions(props.referenceOptions, props.references, referenceToken.query) : [],
    [props.referenceOptions, props.references, referenceToken],
  )
  const commandSuggestions = useMemo(
    () => referenceToken ? [] : getChatCommandSuggestions(props.input),
    [props.input, referenceToken],
  )
  const activeSuggestionCount = referenceSuggestions.length || commandSuggestions.length
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const applyCommand = (command: ChatCommand) => {
    props.setInput(command.insertText)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const position = command.insertText.length
      inputRef.current?.setSelectionRange(position, position)
      setCursorIndex(position)
    })
  }
  const applyReference = (reference: ChatReference) => {
    props.onAddReference(reference)
    const token = getChatReferenceToken(props.input, inputRef.current?.selectionStart ?? cursorIndex)
    if (!token) {
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    const insertText = `@${reference.label} `
    const nextInput = `${props.input.slice(0, token.start)}${insertText}${props.input.slice(token.end)}`
    const nextCursor = token.start + insertText.length
    props.setInput(nextInput)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCursor, nextCursor)
      setCursorIndex(nextCursor)
    })
  }

  useEffect(() => {
    if (selectedCommandIndex >= activeSuggestionCount) {
      setSelectedCommandIndex(0)
    }
  }, [activeSuggestionCount, selectedCommandIndex])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {props.messages.length ? props.messages.map((message, index) => (
          <div
            key={index}
            className={[
              'rounded-lg border p-3 text-ui-md',
              message.role === 'user' ? 'border-line bg-accent-soft' : 'border-line bg-surface',
              message.pending ? 'text-muted' : '',
            ].join(' ')}
          >
            {message.attachments?.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map(attachment => (
                  <img
                    key={attachment.id}
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="h-20 w-20 rounded-lg border border-line object-cover"
                  />
                ))}
              </div>
            ) : null}
            {message.role === 'assistant' && message.content ? (
              <ChatMarkdownContent
                content={message.content}
                streaming={message.pending === true}
                onCitation={props.onCitation}
              />
            ) : (
              <p className="whitespace-pre-wrap">
                {message.role === 'assistant' && message.pending && !message.content
                  ? 'Thinking...'
                  : message.displayContent ?? message.content}
              </p>
            )}
            {message.references?.length ? (
              <ChatReferenceChips references={message.references} />
            ) : null}
          </div>
        )) : (
          <div className="rounded-lg border border-dashed border-line p-4 text-ui-md text-muted">
            Ask for a chapter summary, explain a passage, or search for a concept.
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
        <input
          ref={imageInputRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={event => {
            if (event.currentTarget.files) props.onAddImages(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
        <div className="relative rounded-xl border border-line bg-surface p-1.5 text-ink shadow-menu focus-within:ring-2 focus-within:ring-accent-softer">
          {referenceSuggestions.length ? (
            <div className="absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-80 rounded-xl border border-line bg-surface-raised p-1.5 shadow-menu animate-pop motion-reduce:animate-none">
              {referenceSuggestions.map((reference, index) => (
                <button
                  key={reference.id}
                  type="button"
                  className={[
                    `${menuRowClass} min-w-0`,
                    index === selectedCommandIndex ? 'bg-accent-soft text-accent-text' : '',
                  ].join(' ')}
                  onMouseDown={event => {
                    event.preventDefault()
                    applyReference(reference)
                  }}
                >
                  <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-ui-xs font-semibold text-accent-text">
                    {reference.kind === 'section' ? '章节' : '段落'}
                  </span>
                  <span className="max-w-[45%] shrink-0 truncate font-mono text-ui-md font-semibold text-ink">{reference.label}</span>
                  <span className="min-w-0 truncate">{reference.description}</span>
                </button>
              ))}
            </div>
          ) : commandSuggestions.length ? (
            <div className="absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-80 rounded-xl border border-line bg-surface-raised p-1.5 shadow-menu animate-pop motion-reduce:animate-none">
              {commandSuggestions.map((command, index) => (
                <button
                  key={command.name}
                  type="button"
                  className={[
                    `${menuRowClass} min-w-0`,
                    index === selectedCommandIndex ? 'bg-accent-soft text-accent-text' : '',
                  ].join(' ')}
                  onMouseDown={event => {
                    event.preventDefault()
                    applyCommand(command)
                  }}
                >
                  <span className="max-w-[45%] shrink-0 truncate font-mono text-ui-md font-semibold text-ink">{command.name}</span>
                  <span className="min-w-0 truncate">{command.description}</span>
                </button>
              ))}
            </div>
          ) : null}
          {props.references.length ? (
            <ChatReferenceChips references={props.references} onRemove={props.onRemoveReference} />
          ) : null}
          {props.attachments.length ? (
            <div className="flex flex-wrap gap-2 px-1 pb-2 pt-1">
              {props.attachments.map(attachment => (
                <div key={attachment.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
                  <img className="h-full w-full object-cover" src={attachment.previewUrl} alt={attachment.name} />
                  <button
                    type="button"
                    className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink/80 text-surface"
                    onClick={() => props.onRemoveAttachment(attachment.id)}
                    title="Remove image"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-1.5">
            <button
              className={roundIconButtonClass}
              type="button"
              onClick={() => imageInputRef.current?.click()}
              title="Attach image"
            >
              <Plus className="h-5 w-5" />
            </button>
            <textarea
              ref={inputRef}
              className="max-h-36 min-h-9 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-ui-md text-ink outline-none placeholder:text-muted"
              value={props.input}
              rows={1}
              placeholder="Ask about this book"
              onChange={event => {
                props.setInput(event.target.value)
                setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
              }}
              onClick={event => setCursorIndex(event.currentTarget.selectionStart ?? props.input.length)}
              onKeyUp={event => setCursorIndex(event.currentTarget.selectionStart ?? props.input.length)}
              onKeyDown={event => {
                if (referenceSuggestions.length || commandSuggestions.length) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setSelectedCommandIndex(index => (index + 1) % activeSuggestionCount)
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setSelectedCommandIndex(index => (index - 1 + activeSuggestionCount) % activeSuggestionCount)
                    return
                  }
                  if (event.key === 'Tab') {
                    event.preventDefault()
                    const selectedReference = referenceSuggestions[Math.min(selectedCommandIndex, referenceSuggestions.length - 1)]
                    const selectedCommand = commandSuggestions[Math.min(selectedCommandIndex, commandSuggestions.length - 1)]
                    if (selectedReference) applyReference(selectedReference)
                    else if (selectedCommand) applyCommand(selectedCommand)
                    return
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    if (referenceSuggestions.length) {
                      event.preventDefault()
                      const selectedReference = referenceSuggestions[Math.min(selectedCommandIndex, referenceSuggestions.length - 1)]
                      if (selectedReference) applyReference(selectedReference)
                      return
                    }
                    const selected = commandSuggestions[Math.min(selectedCommandIndex, commandSuggestions.length - 1)]
                    const token = getChatCommandToken(props.input)
                    if (selected && (selected.name !== token || selected.requiresArgs)) {
                      event.preventDefault()
                      applyCommand(selected)
                      return
                    }
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  props.onSend()
                }
              }}
            />
            <button
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent text-ui-md font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-softer"
              type="button"
              disabled={props.busy || (!props.input.trim() && !props.attachments.length && !props.references.length)}
              onClick={props.onSend}
              title="Send"
            >
              {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatReferenceChips({ references, onRemove }: { references: ChatReference[]; onRemove?(id: string): void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-0.5 pb-1.5 pt-0.5">
      {references.map(reference => (
        <span
          key={reference.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent-softer bg-accent-soft px-1.5 py-1 text-ui-sm text-accent-text"
          title={reference.excerpt || reference.description}
        >
          <span className="shrink-0 font-semibold text-accent">{reference.kind === 'section' ? '章节' : '段落'}</span>
          <span className="min-w-0 truncate">{reference.label}</span>
          {onRemove ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center text-muted hover:text-accent-text"
              onClick={() => onRemove(reference.id)}
              title="Remove reference"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function ChatMarkdownLink({
  href,
  children,
  onCitation,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { onCitation(href: string): void }) {
  if (href && isRebookJumpHref(href)) {
    const label = flattenReactText(children) || 'Open citation'
    return <ChatCitationLink {...props} href={href} label={label} onCitation={onCitation} />
  }
  return (
    <a {...props} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

function ChatCitationLink({
  href,
  label,
  onCitation,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; label: string; onCitation(href: string): void }) {
  const pointerHandledRef = useRef(false)
  const openCitation = () => {
    onCitation(href)
  }
  return (
    <a
      {...props}
      href={href}
      data-rebook-citation="true"
      title={label}
      aria-label={label}
      onPointerDown={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        event.preventDefault()
        pointerHandledRef.current = true
        openCitation()
        window.setTimeout(() => {
          pointerHandledRef.current = false
        }, 500)
      }}
      onClick={event => {
        event.preventDefault()
        if (pointerHandledRef.current) return
        openCitation()
      }}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </a>
  )
}

function ChatMarkdownContent({
  content,
  streaming,
  onCitation,
}: {
  content: string
  streaming: boolean
  onCitation(href: string): void
}) {
  const parts = useMemo(() => splitRenderableMarkdownPreviews(content), [content])
  return (
    <div className="chat-markdown">
      {parts.map(part => {
        if (part.type === 'preview') {
          return (
            <ChatCodePreview
              key={`preview-${part.ordinal}`}
              preview={part.preview}
              preProps={{}}
              streaming={streaming}
            />
          )
        }
        const citationDraft = extractStreamingCitationDraft(part.markdown, streaming)
        const markdown = citationDraft?.markdown ?? part.markdown
        return (
          <Fragment key={part.key}>
            {markdown ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkLooseStrong]}
                urlTransform={transformChatMarkdownUrl}
                components={{
                  a: ({ node: _node, href, children, ...linkProps }) => (
                    <ChatMarkdownLink href={href} onCitation={onCitation} {...linkProps}>
                      {children}
                    </ChatMarkdownLink>
                  ),
                  pre: ({ node: _node, children, ...preProps }) => (
                    <ChatMarkdownPre streaming={streaming} {...preProps}>{children}</ChatMarkdownPre>
                  ),
                }}
              >
                {markdown}
              </ReactMarkdown>
            ) : null}
            {citationDraft ? (
              <ChatCitationLink
                href={citationDraft.href}
                label={citationDraft.label}
                onCitation={onCitation}
              />
            ) : null}
          </Fragment>
        )
      })}
    </div>
  )
}

type ChatMarkdownPart =
  | { type: 'markdown'; key: string; markdown: string }
  | { type: 'preview'; ordinal: number; preview: RenderableCodePreview }

function splitRenderableMarkdownPreviews(markdown: string): ChatMarkdownPart[] {
  const parts: ChatMarkdownPart[] = []
  const fencePattern = /(^|\n)(```|~~~)([^\n]*)\n/g
  let cursor = 0
  let previewOrdinal = 0

  while (true) {
    const match = fencePattern.exec(markdown)
    if (!match) break

    const fenceStart = match.index + match[1].length
    const fence = match[2]
    const info = match[3] ?? ''
    const codeStart = fencePattern.lastIndex
    const closePattern = new RegExp(`\\n${escapeRegExp(fence)}[ \\t]*(?=\\n|$)`, 'g')
    closePattern.lastIndex = codeStart
    const close = closePattern.exec(markdown)
    const codeEnd = close ? close.index : markdown.length
    const code = markdown.slice(codeStart, codeEnd)
    const preview = getRenderableCodePreviewFromCode(info, code)

    if (!preview) {
      fencePattern.lastIndex = codeStart
      continue
    }

    appendMarkdownPart(parts, markdown.slice(cursor, fenceStart), `markdown-${parts.length}`)
    parts.push({
      type: 'preview',
      ordinal: previewOrdinal++,
      preview,
    })
    cursor = close ? close.index + close[0].length : markdown.length
    fencePattern.lastIndex = cursor
  }

  appendMarkdownPart(parts, markdown.slice(cursor), `markdown-${parts.length}`)
  return parts
}

function appendMarkdownPart(parts: ChatMarkdownPart[], markdown: string, key: string): void {
  if (!markdown) return
  parts.push({ type: 'markdown', key, markdown })
}

function extractStreamingCitationDraft(markdown: string, streaming: boolean): { markdown: string; href: string; label: string } | null {
  if (!streaming) return null
  const match = /\[([^\]\n]{0,80})\]\((rebook:\/\/j\/[^)\s]*)$/.exec(markdown)
  if (!match) return null
  const href = match[2]
  if (!parseRebookJumpHref(href)) return null
  return {
    markdown: markdown.slice(0, match.index),
    href,
    label: match[1] || '出处',
  }
}

function ChatMarkdownPre({ children, streaming, ...props }: HTMLAttributes<HTMLPreElement> & { streaming?: boolean }) {
  const preview = getRenderableCodePreview(children)
  if (!preview) return <pre {...props}>{children}</pre>
  return <ChatCodePreview preview={preview} preProps={props} streaming={streaming === true} />
}

function ChatCodePreview({
  preview,
  preProps,
  streaming,
}: {
  preview: RenderableCodePreview
  preProps: HTMLAttributes<HTMLPreElement>
  streaming: boolean
}) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [collapsed, setCollapsed] = useState(false)
  const [frameHeight, setFrameHeight] = useState(360)
  const [mermaidResult, setMermaidResult] = useState<MermaidPreviewResult | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const pendingPreviewWriteRef = useRef<number | null>(null)
  const lastFrameWidthRef = useRef(0)
  const mermaidAttemptedCodeRef = useRef('')
  const mermaidInFlightRef = useRef(false)
  const mermaidLatestCodeRef = useRef('')
  const mermaidRenderSessionRef = useRef(0)
  const mermaidRenderTimerRef = useRef<number | null>(null)
  const mermaidStreamingRef = useRef(streaming)
  const framePreview = getPreviewFrameContent(preview, mermaidResult, streaming)
  mermaidStreamingRef.current = streaming

  const scheduleMermaidRender = (delay: number) => {
    if (mermaidRenderTimerRef.current != null || mermaidInFlightRef.current) return
    mermaidRenderTimerRef.current = window.setTimeout(() => {
      mermaidRenderTimerRef.current = null
      void runMermaidRender()
    }, delay)
  }

  const runMermaidRender = async () => {
    if (mermaidInFlightRef.current) return
    const session = mermaidRenderSessionRef.current
    const code = mermaidLatestCodeRef.current
    if (!code || code === mermaidAttemptedCodeRef.current) return

    mermaidAttemptedCodeRef.current = code
    mermaidInFlightRef.current = true
    try {
      const svg = await renderMermaidDiagram(code)
      if (session === mermaidRenderSessionRef.current) {
        setMermaidResult({ code, svg })
      }
    } catch (error) {
      if (session === mermaidRenderSessionRef.current) {
        setMermaidResult(current => mermaidStreamingRef.current && current?.svg ? current : {
          code,
          error: mermaidStreamingRef.current ? undefined : formatError(error),
        })
      }
    } finally {
      mermaidInFlightRef.current = false
      if (session === mermaidRenderSessionRef.current && mermaidLatestCodeRef.current !== mermaidAttemptedCodeRef.current) {
        scheduleMermaidRender(mermaidStreamingRef.current ? 120 : 0)
      }
    }
  }

  const measureFrameHeight = useCallback((mode: 'fit' | 'grow' = 'fit') => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    const body = doc.body
    const previewRoot = doc.getElementById('preview-root')
    const bodyStyle = body ? doc.defaultView?.getComputedStyle(body) : null
    const verticalPadding = bodyStyle
      ? Number.parseFloat(bodyStyle.paddingTop || '0') + Number.parseFloat(bodyStyle.paddingBottom || '0')
      : 0
    const rootRect = previewRoot?.getBoundingClientRect()
    const svgRect = previewRoot?.querySelector('svg')?.getBoundingClientRect()
    const height = Math.max(
      previewRoot?.scrollHeight ?? 0,
      previewRoot?.offsetHeight ?? 0,
      rootRect?.height ?? 0,
      svgRect?.height ?? 0,
    ) + verticalPadding
    if (height > 0) {
      const safetyPadding = body?.dataset.previewKind === 'svg' ? 24 : 2
      const nextHeight = clampPreviewFrameHeight(height + safetyPadding)
      setFrameHeight(current => mode === 'grow' ? Math.max(current, nextHeight) : nextHeight)
    }
  }, [])

  const scheduleFrameMeasure = useCallback((mode: 'fit' | 'grow') => {
    requestAnimationFrame(() => {
      measureFrameHeight(mode)
      requestAnimationFrame(() => measureFrameHeight(mode))
    })
  }, [measureFrameHeight])

  useEffect(() => {
    setFrameHeight(360)
    setCollapsed(false)
  }, [preview.kind])

  useEffect(() => {
    if (preview.kind !== 'mermaid') {
      mermaidAttemptedCodeRef.current = ''
      mermaidLatestCodeRef.current = ''
      mermaidRenderSessionRef.current += 1
      if (mermaidRenderTimerRef.current != null) {
        window.clearTimeout(mermaidRenderTimerRef.current)
        mermaidRenderTimerRef.current = null
      }
      setMermaidResult(null)
    }
  }, [preview.kind])

  useEffect(() => {
    const code = getMermaidRenderCode(preview.code, streaming)
    if (preview.kind !== 'mermaid') return
    if (!code) {
      if (!streaming) setMermaidResult(null)
      return
    }

    mermaidLatestCodeRef.current = code
    scheduleMermaidRender(streaming ? 80 : 0)
  }, [preview.code, preview.kind, streaming])

  useEffect(() => {
    return () => {
      mermaidRenderSessionRef.current += 1
      if (mermaidRenderTimerRef.current != null) {
        window.clearTimeout(mermaidRenderTimerRef.current)
        mermaidRenderTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (tab !== 'preview') return
    if (pendingPreviewWriteRef.current != null) window.clearTimeout(pendingPreviewWriteRef.current)
    pendingPreviewWriteRef.current = window.setTimeout(() => {
      pendingPreviewWriteRef.current = null
      const wrote = writePreviewFrameContent(frameRef.current, framePreview)
      if (streaming) {
        if (wrote) scheduleFrameMeasure('grow')
        return
      }
      scheduleFrameMeasure('fit')
    }, streaming ? 120 : 0)
    return () => {
      if (pendingPreviewWriteRef.current != null) {
        window.clearTimeout(pendingPreviewWriteRef.current)
        pendingPreviewWriteRef.current = null
      }
    }
  }, [framePreview.html, framePreview.kind, scheduleFrameMeasure, streaming, tab])

  useEffect(() => {
    if (tab !== 'preview') return
    const frame = frameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') return
    let frameId: number | null = null
    lastFrameWidthRef.current = frame.getBoundingClientRect().width
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? frame.getBoundingClientRect().width
      if (Math.abs(width - lastFrameWidthRef.current) < 1) return
      lastFrameWidthRef.current = width
      if (frameId != null) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        frameId = null
        scheduleFrameMeasure('fit')
      })
    })
    observer.observe(frame)
    return () => {
      if (frameId != null) cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [scheduleFrameMeasure, tab])

  const effectiveFrameHeight = collapsed ? Math.min(frameHeight, 260) : frameHeight

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-surface-muted px-2.5 py-1.5 text-ui-sm font-semibold text-muted-strong">
        <span>{preview.label}</span>
        <div className="inline-flex items-center gap-1.5">
          {tab === 'preview' ? (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-strong transition-colors duration-150 hover:bg-track hover:text-ink"
              onClick={() => setCollapsed(value => !value)}
              title={collapsed ? 'Expand preview height' : 'Collapse preview height'}
            >
              {collapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          <div className="inline-flex gap-1 rounded-full bg-track p-0.5">
            <button
              type="button"
              className={[
                'rounded-full px-2 py-1 text-ui-sm font-semibold transition-colors duration-150',
                tab === 'preview' ? 'bg-surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
              ].join(' ')}
              onClick={() => setTab('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              className={[
                'rounded-full px-2 py-1 text-ui-sm font-semibold transition-colors duration-150',
                tab === 'code' ? 'bg-surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
              ].join(' ')}
              onClick={() => setTab('code')}
            >
              Code
            </button>
          </div>
        </div>
      </div>
      {tab === 'preview' ? (
        <iframe
          ref={frameRef}
          className="block w-full border-0 bg-surface"
          sandbox="allow-same-origin"
          srcDoc={PREVIEW_SHELL_DOCUMENT}
          style={{ height: effectiveFrameHeight }}
          title={`${preview.label} preview`}
          onLoad={() => {
            writePreviewFrameContent(frameRef.current, framePreview)
            scheduleFrameMeasure(streaming ? 'grow' : 'fit')
          }}
        />
      ) : (
        <pre
          {...preProps}
          className={['!m-0 !rounded-none', preProps.className].filter(Boolean).join(' ')}
        >
          <code className={preview.className}>{preview.code}</code>
        </pre>
      )}
    </div>
  )
}

function clampPreviewFrameHeight(height: number): number {
  return Math.max(260, Math.min(3600, Math.ceil(height)))
}

interface RenderableCodePreview {
  label: string
  kind: RenderableCodePreviewKind
  html: string
  code: string
  className?: string
}

type RenderableCodePreviewKind = PreviewFrameKind | 'mermaid'
type PreviewFrameKind = 'svg' | 'html'

interface PreviewFrameContent {
  kind: PreviewFrameKind
  html: string
}

interface MermaidPreviewResult {
  code: string
  svg?: string
  error?: string
}

function getRenderableCodePreview(children: ReactNode): RenderableCodePreview | null {
  const child = Array.isArray(children) ? children.find(isValidElement) : children
  if (!isValidElement(child)) return null
  const element = child as ReactElement<{ className?: string; children?: ReactNode }>
  const className = element.props.className ?? ''
  const language = normalizeCodeLanguage(/\blanguage-([^\s]+)\b/i.exec(className)?.[1])
  const code = flattenReactText(element.props.children).trim()
  return getRenderableCodePreviewFromCode(language, code, className)
}

function getRenderableCodePreviewFromCode(language: string | undefined, rawCode: string, className?: string): RenderableCodePreview | null {
  const normalizedLanguage = normalizeCodeLanguage(language)
  const code = rawCode.trim()
  if (!code) return null
  if (normalizedLanguage === 'mermaid' || normalizedLanguage === 'mmd') {
    const mermaidCode = rawCode.trimStart()
    return {
      label: 'Mermaid',
      kind: 'mermaid',
      html: mermaidCode,
      code: mermaidCode,
      className,
    }
  }
  if (normalizedLanguage === 'svg' || looksLikeSVG(code)) {
    return {
      label: 'SVG',
      kind: 'svg',
      html: code,
      code,
      className,
    }
  }
  if (normalizedLanguage === 'html' || looksLikeHTML(code)) {
    return {
      label: 'HTML',
      kind: 'html',
      html: code,
      code,
      className,
    }
  }
  return null
}

function normalizeCodeLanguage(value: string | undefined): string | undefined {
  return value?.trim().split(/\s+/, 1)[0]?.replace(/^language-/i, '').toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksLikeSVG(value: string): boolean {
  return /^\s*<svg[\s>]/i.test(value)
}

function looksLikeHTML(value: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html[\s>]|<body[\s>]|<(?:div|main|section|article|style|canvas|table|form|button|h[1-6]|p|ul|ol|svg)[\s>])/i.test(value)
}

const PREVIEW_SHELL_DOCUMENT = [
  '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">',
  '<style>',
  'html,body{margin:0;min-height:100%;overflow:hidden;background:#fff;color:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
  'body{box-sizing:border-box}',
  'body[data-preview-kind="svg"]{display:block;padding:16px}',
  'body[data-preview-kind="html"]{display:block;padding:0}',
  '#preview-root,#preview-buffer{width:100%;box-sizing:border-box}',
  'body[data-preview-kind="svg"] #preview-root{display:block;text-align:center}',
  'body[data-preview-kind="html"] #preview-root{display:flow-root}',
  '#preview-buffer{position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;overflow:hidden}',
  '.preview-status{display:grid;min-height:220px;place-items:center;padding:24px;color:#64748b;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center}',
  '.preview-status.is-error{color:#b91c1c;white-space:pre-wrap}',
  'svg{max-width:100%;height:auto;overflow:visible}',
  '</style></head><body data-preview-kind="html"><div id="preview-root"></div><div id="preview-buffer"></div></body></html>',
].join('')

const previewFrameContentCache = new WeakMap<HTMLIFrameElement, string>()

function getPreviewFrameContent(preview: RenderableCodePreview, mermaidResult: MermaidPreviewResult | null, streaming: boolean): PreviewFrameContent {
  if (preview.kind !== 'mermaid') return { kind: preview.kind, html: preview.html }
  if (mermaidResult?.svg) return { kind: 'svg', html: mermaidResult.svg }
  if (mermaidResult?.error && !streaming) {
    return {
      kind: 'html',
      html: `<div class="preview-status is-error">Mermaid render failed:\n${escapeHTML(mermaidResult.error)}</div>`,
    }
  }
  return {
    kind: 'html',
    html: '<div class="preview-status">Rendering Mermaid diagram...</div>',
  }
}

function writePreviewFrameContent(frame: HTMLIFrameElement | null, preview: PreviewFrameContent): boolean {
  const doc = frame?.contentDocument
  const root = doc?.getElementById('preview-root')
  const buffer = doc?.getElementById('preview-buffer')
  const cacheKey = `${preview.kind}\n${preview.html}`
  if (!frame || !doc || !root || !buffer || previewFrameContentCache.get(frame) === cacheKey) return false
  doc.body.dataset.previewKind = preview.kind
  buffer.innerHTML = getPreviewParseHTML(preview)
  if (!hasRenderablePreviewContent(buffer, preview.kind)) return false
  root.replaceChildren(...Array.from(buffer.childNodes).map(node => node.cloneNode(true)))
  buffer.replaceChildren()
  previewFrameContentCache.set(frame, cacheKey)
  return true
}

function getPreviewParseHTML(preview: PreviewFrameContent): string {
  if (preview.kind !== 'svg' || /<\/svg\s*>/i.test(preview.html)) return preview.html
  return `${preview.html}\n</svg>`
}

function hasRenderablePreviewContent(root: HTMLElement, kind: PreviewFrameKind): boolean {
  if (kind === 'svg') return Boolean(root.querySelector('svg'))
  return root.childNodes.length > 0
}

let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null
let mermaidRenderCounter = 0

async function getMermaidModule(): Promise<typeof import('mermaid')> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then(module => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      })
      return module
    })
  }
  return mermaidModulePromise
}

async function renderMermaidDiagram(code: string): Promise<string> {
  const { default: mermaid } = await getMermaidModule()
  const id = `rebook-mermaid-${++mermaidRenderCounter}`
  const result = await mermaid.render(id, code)
  return result.svg
}

function getMermaidRenderCode(code: string, streaming: boolean): string {
  const value = code.trimStart()
  if (!streaming) return value.trim()
  if (/\r?\n\s*$/.test(value)) return value.trim()
  const trimmed = value.trimEnd()
  const lines = trimmed.split(/\r?\n/)
  if (lines.length <= 1) return trimmed.trim()
  return lines.slice(0, -1).join('\n').trim()
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function flattenReactText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(flattenReactText).join('')
  return ''
}

function SettingsDialog(props: {
  section: SettingsSection
  setSection(section: SettingsSection): void
  config: DemoConfig
  setConfig(config: DemoConfig): void
  extensionRuntimeStatus: DemoExtensionRuntimeStatus
  currentBookFileName?: string
  storyUploadBusy: boolean
  storyUploadStatus: string
  onUploadCurrentBook(config: DemoConfig): Promise<{ bookId: string; title?: string }>
  onClose(): void
  onApply(): void
}) {
  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: 'font', label: '字体' },
    { id: 'reading', label: '阅读' },
  ]
  if (props.config.translate) sections.push({ id: 'translation', label: '翻译' })
  if (props.config.tts) sections.push({ id: 'tts', label: '朗读' })
  if (props.config.chat) sections.push({ id: 'chat', label: 'AI 对话' })
  sections.push({ id: 'debug', label: '调试' })
  return (
    <div className="fixed inset-0 z-90 grid place-items-center bg-overlay p-4">
      <div className="flex h-[min(760px,92vh)] w-[min(980px,96vw)] flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-dialog sm:flex-row">
        <aside className="w-full shrink-0 border-b border-line bg-surface-muted p-2 sm:w-56 sm:border-b-0 sm:border-r sm:p-3">
          <div className="mb-3 px-2 text-ui-md font-semibold text-ink">设置</div>
          <nav className="flex gap-1 overflow-x-auto sm:block sm:space-y-1">
            {sections.map(section => (
              <button
                key={section.id}
                type="button"
                className={[
                  'block shrink-0 rounded-lg px-3 py-2 text-left text-ui-md sm:w-full',
                  props.section === section.id ? 'bg-accent-soft font-medium text-accent-text' : 'text-ink-soft hover:bg-surface',
                ].join(' ')}
                onClick={() => props.setSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 items-center justify-between border-b border-line px-5">
            <h2 className="text-ui-lg font-semibold text-ink">{sections.find(item => item.id === props.section)?.label}</h2>
            <button className={iconButtonClass} type="button" onClick={props.onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <SettingsSectionForm
              section={props.section}
              setSection={props.setSection}
              config={props.config}
              setConfig={props.setConfig}
              extensionRuntimeStatus={props.extensionRuntimeStatus}
              currentBookFileName={props.currentBookFileName}
              storyUploadBusy={props.storyUploadBusy}
              storyUploadStatus={props.storyUploadStatus}
              onUploadCurrentBook={props.onUploadCurrentBook}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-line p-4">
            <button className={toolbarButtonClass} type="button" onClick={props.onClose}>取消</button>
            <button className={primaryButtonClass} type="button" onClick={props.onApply}>应用</button>
          </div>
        </section>
      </div>
    </div>
  )
}

function SettingsSectionForm({
  section,
  setSection,
  config,
  setConfig,
  extensionRuntimeStatus,
  currentBookFileName,
  storyUploadBusy,
  storyUploadStatus,
  onUploadCurrentBook,
}: {
  section: SettingsSection
  setSection(section: SettingsSection): void
  config: DemoConfig
  setConfig(config: DemoConfig): void
  extensionRuntimeStatus: DemoExtensionRuntimeStatus
  currentBookFileName?: string
  storyUploadBusy: boolean
  storyUploadStatus: string
  onUploadCurrentBook(config: DemoConfig): Promise<{ bookId: string; title?: string }>
}) {
  const update = <K extends keyof DemoConfig>(key: K, value: DemoConfig[K]) => setConfig({ ...config, [key]: value })
  if (section === 'font') {
    return <FontSettingsForm config={config} setConfig={setConfig} />
  }
  if (section === 'reading') {
    return (
      <FormGrid>
        <SelectField label="Layout" value={config.layout} onChange={value => update('layout', value as DemoConfig['layout'])} options={[['paginated', 'Paginated'], ['scrolled', 'Scrolled']]} />
        <SelectField label="Spread" value={config.spread} onChange={value => update('spread', value)} options={[['2', 'Auto spread'], ['1', 'Single page']]} />
        <SelectField label="Page fit" value={config.reflowablePageFit} onChange={value => update('reflowablePageFit', value as ReflowablePageFitMode)} options={[['viewport', 'Viewport'], ['paper', 'Paper page'], ['auto', 'Auto']]} />
        <SelectField label="Fixed painter" value={config.fixedPainter} onChange={value => update('fixedPainter', value)} options={[['auto', 'Auto'], ['canvas', 'Canvas 2D'], ['webgpu', 'WebGPU']]} />
        <CheckField label="Hyphenate" checked={config.hyphenate} onChange={value => update('hyphenate', value)} />
      </FormGrid>
    )
  }
  if (section === 'extensions') {
    return (
      <ExtensionsSettings
        config={config}
        setConfig={setConfig}
        setSection={setSection}
        extensionRuntimeStatus={extensionRuntimeStatus}
      />
    )
  }
  if (section === 'translation') {
    return (
      <FormGrid>
        {config.professionalTranslation ? (
          <>
            <TextField label="Service URL" value={config.professionalServiceBaseUrl} onChange={value => update('professionalServiceBaseUrl', value)} />
            <TextField label="Book ID" value={config.professionalBookId} onChange={value => update('professionalBookId', value)} />
          </>
        ) : (
          <>
            <TextField label="Base URL" value={config.baseURL} onChange={value => update('baseURL', value)} />
            <TextField label="API key" value={config.apiKey} type="password" onChange={value => update('apiKey', value)} />
            <TextField label="Model" value={config.model} onChange={value => update('model', value)} placeholder="gpt-4o-mini" />
            <CheckField label="Translate TOC" checked={config.translateTOC} onChange={value => update('translateTOC', value)} />
          </>
        )}
        <SelectField label="Mode" value={config.translateMode} onChange={value => update('translateMode', value as DemoConfig['translateMode'])} options={[['bilingual', 'Bilingual'], ['replace', 'Replace']]} />
        <TextField label="Prefetch pages" value={config.prefetchPages} type="number" onChange={value => update('prefetchPages', value)} />
      </FormGrid>
    )
  }
  if (section === 'tts') {
    return (
      <FormGrid>
        <TextField label="Endpoint" value={config.ttsEndpoint} onChange={value => update('ttsEndpoint', value)} />
        <TextField label="Provider" value={config.ttsProvider} onChange={value => update('ttsProvider', value)} />
        <TextField label="SFX provider" value={config.ttsSoundEffectProvider} onChange={value => update('ttsSoundEffectProvider', value)} />
        <TextField label="Voice" value={config.ttsVoice} onChange={value => update('ttsVoice', value)} />
        <TextField label="Segment chars" value={config.ttsSegmentChars} type="number" onChange={value => update('ttsSegmentChars', value)} />
        <TextField label="Speed" value={config.ttsSpeed} type="number" onChange={value => update('ttsSpeed', value)} />
        <CheckField label="Multi voice" checked={config.ttsMultiSpeaker} onChange={value => update('ttsMultiSpeaker', value)} />
        <TextField label="TTS AI Base URL" value={config.ttsAIBaseURL} onChange={value => update('ttsAIBaseURL', value)} />
        <TextField label="TTS AI API key" value={config.ttsAIAPIKey} type="password" onChange={value => update('ttsAIAPIKey', value)} />
        <TextField label="TTS AI model" value={config.ttsModel} onChange={value => update('ttsModel', value)} placeholder="gpt-4o-mini" />
        <TextField label="Narrator voice" value={config.ttsNarratorVoice} onChange={value => update('ttsNarratorVoice', value)} />
        <TextField label="Male voices" value={config.ttsMaleVoices} onChange={value => update('ttsMaleVoices', value)} />
        <TextField label="Female voices" value={config.ttsFemaleVoices} onChange={value => update('ttsFemaleVoices', value)} />
        <TextField label="Other voice" value={config.ttsOtherVoice} onChange={value => update('ttsOtherVoice', value)} />
      </FormGrid>
    )
  }
  if (section === 'chat') {
    return (
      <FormGrid>
        <TextField label="Base URL" value={config.chatBaseURL} onChange={value => update('chatBaseURL', value)} />
        <TextField label="API key" value={config.chatAPIKey} type="password" onChange={value => update('chatAPIKey', value)} />
        <TextField label="Model" value={config.chatModel} onChange={value => update('chatModel', value)} placeholder="gpt-4o-mini" />
        <TextField label="Content chars" value={config.chatMaxContentChars} type="number" onChange={value => update('chatMaxContentChars', value)} />
        <TextField label="Story service URL" value={config.professionalServiceBaseUrl} onChange={value => update('professionalServiceBaseUrl', value)} />
        <TextField label="Story book ID" value={config.professionalBookId} onChange={value => update('professionalBookId', value)} />
        <div className="grid gap-2 rounded-xl border border-line bg-surface p-3">
          <div className="text-ui-md font-medium text-ink-soft">
            Current file: {currentBookFileName || 'none'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={toolbarButtonClass}
              type="button"
              disabled={storyUploadBusy || !currentBookFileName}
              onClick={() => {
                void onUploadCurrentBook(config)
                  .then(result => setConfig({ ...config, professionalBookId: result.bookId }))
                  .catch(() => undefined)
              }}
            >
              {storyUploadBusy ? 'Uploading...' : 'Upload current book'}
            </button>
            <span className="text-ui-sm text-muted">Uploads to /api/books/upload and fills Story book ID.</span>
          </div>
          {storyUploadStatus ? (
            <p className="text-ui-sm text-muted">{storyUploadStatus}</p>
          ) : null}
        </div>
        <p className="col-span-full text-ui-sm text-muted">
          Story memory tools use the same rebook-service URL and Book ID as professional translation.
        </p>
      </FormGrid>
    )
  }
  return (
    <FormGrid>
      <CheckField label="Debug logging" checked={config.debug} onChange={value => update('debug', value)} />
    </FormGrid>
  )
}

function FontSettingsForm({ config, setConfig }: { config: DemoConfig; setConfig(config: DemoConfig): void }) {
  const update = <K extends keyof DemoConfig>(key: K, value: DemoConfig[K]) => setConfig({ ...config, [key]: value })
  const families = getReaderFontFamilies(config)
  const previewFamily = config.defaultFont === 'serif' ? families.serif : families.sansSerif

  return (
    <div className="min-h-full bg-surface-muted p-5 sm:p-7">
      <div className="mx-auto grid max-w-2xl gap-6">
        <FontSettingsGroup title="字体类型">
          <FontSelectRow
            label="默认字体"
            value={config.defaultFont}
            options={[["serif", "衬线字体"], ["sans-serif", "无衬线字体"]]}
            onChange={value => update('defaultFont', value as ReaderDefaultFont)}
          />
          <FontSelectRow
            label="中文字体"
            value={config.defaultCJKFont}
            options={CJK_FONT_OPTIONS}
            previewFamily={config.defaultCJKFont}
            onChange={value => update('defaultCJKFont', value)}
          />
        </FontSettingsGroup>

        <FontSettingsGroup title="字体选择">
          <FontSelectRow
            label="衬线字体"
            value={config.serifFont}
            options={SERIF_FONT_OPTIONS}
            previewFamily={config.serifFont}
            onChange={value => update('serifFont', value)}
          />
          <FontSelectRow
            label="无衬线字体"
            value={config.sansSerifFont}
            options={SANS_SERIF_FONT_OPTIONS}
            previewFamily={config.sansSerifFont}
            onChange={value => update('sansSerifFont', value)}
          />
          <FontSelectRow
            label="等宽字体"
            value={config.monospaceFont}
            options={MONOSPACE_FONT_OPTIONS}
            previewFamily={config.monospaceFont}
            onChange={value => update('monospaceFont', value)}
          />
        </FontSettingsGroup>

        <FontSettingsGroup title="文字显示">
          <FontSelectRow
            label="字号"
            value={config.fontSize}
            options={[["14px", "14 px"], ["16px", "16 px"], ["18px", "18 px"], ["20px", "20 px"], ["22px", "22 px"]]}
            onChange={value => update('fontSize', value)}
          />
          <FontToggleRow
            label="覆盖书籍字体"
            description="开启后忽略书籍自带字体，统一使用上面的设置"
            checked={config.overrideBookFonts}
            onChange={value => update('overrideBookFonts', value)}
          />
        </FontSettingsGroup>

        <div className="rounded-xl border border-line bg-surface px-5 py-4">
          <div className="mb-2 text-ui-sm font-medium text-muted">字体预览</div>
          <p className="m-0 text-ui-xl text-ink" style={{ fontFamily: previewFamily }}>
            阅读让思想抵达更远的地方。The quick brown fox jumps over the lazy dog.
          </p>
        </div>
        <p className="m-0 text-ui-sm text-muted">
          字体通过 CDN 按需加载；网络不可用时会自动回退到设备字体。设置仅影响可重排格式，PDF 与 CBZ 保持原始版面。
        </p>
      </div>
    </div>
  )
}

function FontSettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 px-1 text-ui-sm font-medium text-muted">{title}</h3>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {children}
      </div>
    </section>
  )
}

function FontSelectRow({
  label,
  value,
  options,
  previewFamily,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  previewFamily?: string
  onChange(value: string): void
}) {
  return (
    <label className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <span className="text-ui-md font-medium text-ink-soft">{label}</span>
      <Select
        className="min-w-36 max-w-[58%]"
        buttonClassName="border-transparent bg-surface-muted"
        value={value}
        options={options}
        ariaLabel={label}
        previewFamily={previewFamily ? optionValue => `"${optionValue}", sans-serif` : undefined}
        onChange={onChange}
      />
    </label>
  )
}

function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onChange(value: boolean): void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-accent' : 'bg-track'} ${disabled ? 'opacity-40' : ''}`}>
      <input
        className="peer sr-only"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={event => onChange(event.target.checked)}
      />
      <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-surface-raised shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`} />
    </span>
  )
}

function FontToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange(value: boolean): void
}) {
  return (
    <label className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <span className="min-w-0">
        <span className="block text-ui-md font-medium text-ink-soft">{label}</span>
        <span className="mt-0.5 block text-ui-sm text-muted">{description}</span>
      </span>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </label>
  )
}

function ExtensionsSettings({
  config,
  setConfig,
  setSection,
  extensionRuntimeStatus,
}: {
  config: DemoConfig
  setConfig(config: DemoConfig): void
  setSection(section: SettingsSection): void
  extensionRuntimeStatus: DemoExtensionRuntimeStatus
}) {
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogStatus, setCatalogStatus] = useState('')
  const marketplaceCatalog = getDemoMarketplaceCatalogParseResult(config)
  const extensionItems = createDemoExtensionManager(config).listItems()

  const loadMarketplaceCatalog = async () => {
    const url = config.extensionCatalogURL.trim()
    if (!url) {
      setCatalogStatus('Enter a catalog URL first.')
      return
    }
    setCatalogLoading(true)
    setCatalogStatus('')
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`)
      const text = await response.text()
      parseRebookExtensionCatalogEntries(JSON.parse(text), { source: 'marketplace' })
      setConfig(normalizeConfig({ ...config, extensionCatalogJSON: text }))
      setCatalogStatus('Catalog loaded.')
    } catch (error) {
      setCatalogStatus(`Catalog load failed: ${formatError(error)}`)
    } finally {
      setCatalogLoading(false)
    }
  }

  return (
    <div className="grid gap-3 p-5">
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-ui-md font-semibold text-ink">Marketplace catalog</h3>
            <p className="mt-1 text-ui-md text-muted">
              Load a schemaVersion 1 extension catalog. Installed marketplace entries are stored locally in this demo.
            </p>
          </div>
          <button
            type="button"
            className={toolbarButtonClass}
            disabled={catalogLoading || !config.extensionCatalogURL.trim()}
            onClick={loadMarketplaceCatalog}
          >
            {catalogLoading ? 'Loading...' : 'Load URL'}
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          <TextField
            label="Catalog URL"
            value={config.extensionCatalogURL}
            placeholder="https://example.com/rebook-extension-catalog.json"
            onChange={value => setConfig({ ...config, extensionCatalogURL: value })}
          />
          <TextAreaField
            label="Catalog JSON"
            value={config.extensionCatalogJSON}
            placeholder='{"schemaVersion":1,"source":"marketplace","entries":[...]}'
            onChange={value => setConfig({ ...config, extensionCatalogJSON: value })}
          />
          <p className={[
            'text-ui-sm',
            marketplaceCatalog.error || catalogStatus.startsWith('Catalog load failed')
              ? 'text-danger'
              : 'text-muted',
          ].join(' ')}>
            {marketplaceCatalog.error || catalogStatus || `${marketplaceCatalog.entries.length} marketplace extension(s) loaded.`}
          </p>
        </div>
      </section>
      {extensionItems.map(item => {
        const state = getDemoExtensionState(item, config)
        const contributionBadges = getDemoExtensionContributionBadges(item.manifest)
        const runtimeStatus = extensionRuntimeStatus[item.manifest.id]
        return (
          <article key={item.manifest.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-ui-md font-semibold text-ink">
                    {item.manifest.displayName || item.manifest.name}
                  </h3>
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-ui-sm font-medium text-muted">
                    {item.source || 'local'}
                  </span>
                  <span className={[
                    'rounded-full px-2 py-0.5 text-ui-sm font-medium',
                    !state.installed
                      ? 'bg-surface-muted text-muted'
                      : state.enabled
                      ? state.configured ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
                      : 'bg-surface-muted text-muted',
                  ].join(' ')}>
                    {!state.installed ? 'Available' : state.enabled ? state.configured ? 'Enabled' : 'Needs setup' : 'Disabled'}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-ui-md text-muted">{item.manifest.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.manifest.capabilities?.map(capability => (
                    <span key={capability} className="rounded-lg bg-accent-soft px-1.5 py-0.5 text-ui-xs font-medium text-accent-text">
                      {capability}
                    </span>
                  ))}
                </div>
                {contributionBadges.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {contributionBadges.map(badge => (
                      <span key={badge} className="rounded-lg bg-surface-muted px-1.5 py-0.5 text-ui-xs font-medium text-muted">
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="mt-3 text-ui-sm text-muted">{state.message}</p>
                {state.installed && !isDemoExtensionFeatureControlled(item.manifest) ? (
                  <p className={[
                    'mt-2 text-ui-sm',
                    runtimeStatus?.state === 'loaded'
                      ? 'text-success'
                      : runtimeStatus?.state === 'error'
                      ? 'text-danger'
                      : 'text-muted',
                  ].join(' ')}>
                    {runtimeStatus?.message || 'Enable this extension to load its runtime module.'}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state.installed ? (
                  <>
                    <button
                      type="button"
                      className={toolbarButtonClass}
                      onClick={() => setSection(state.settingsSection)}
                    >
                      Configure
                    </button>
                    <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-ui-md font-medium text-ink-soft">
                      <span>{state.enabled ? 'On' : 'Off'}</span>
                      <Toggle
                        checked={state.enabled}
                        ariaLabel={`Toggle ${item.manifest.displayName || item.manifest.name}`}
                        onChange={value => setConfig(setDemoExtensionEnabled(config, item.manifest, value))}
                      />
                    </label>
                    {item.source !== 'builtin' ? (
                      <button
                        type="button"
                        className={toolbarButtonClass}
                        onClick={() => setConfig(uninstallDemoExtension(config, item.manifest))}
                      >
                        Uninstall
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    className={primaryButtonClass}
                    onClick={() => setConfig(installDemoExtension(config, item.manifest))}
                  >
                    Install
                  </button>
                )}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function Footer({
  ttsEnabled,
  ttsStatus,
  onPlayTTS,
  onStopTTS,
}: {
  ttsEnabled: boolean
  ttsStatus: string
  onPlayTTS(): void
  onStopTTS(): void
}) {
  if (!ttsEnabled) return null
  return (
    <footer className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface/92 px-4 text-ui-sm text-muted">
      <div className="min-w-0 flex-1" />
      <div className="min-w-0 max-w-xs truncate">{ttsStatus}</div>
      <button className={toolbarButtonClass} type="button" onClick={onPlayTTS}>
        <Volume2 className="h-4 w-4" />
        朗读
      </button>
      <button className={toolbarButtonClass} type="button" onClick={onStopTTS}>停止</button>
    </footer>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid max-w-2xl gap-4 p-5">{children}</div>
}

function TextField({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange(value: string): void; type?: string; placeholder?: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-ui-sm font-medium uppercase tracking-wide text-muted">{label}</span>
      <input className={inputClass} type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange(value: string): void; placeholder?: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-ui-sm font-medium uppercase tracking-wide text-muted">{label}</span>
      <textarea
        className={`${inputClass} min-h-36 resize-y font-mono text-ui-sm`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  )
}

function Select({
  value,
  onChange,
  options,
  disabled = false,
  ariaLabel,
  className,
  buttonClassName,
  previewFamily,
}: {
  value: string
  onChange(value: string): void
  options: Array<[string, string]>
  disabled?: boolean
  ariaLabel?: string
  className?: string
  buttonClassName?: string
  previewFamily?: (value: string) => string | undefined
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex(([optionValue]) => optionValue === value))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const selectedLabel = options[selectedIndex]?.[1] ?? value

  const closeList = (refocus = false) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const openList = () => {
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      [activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option[0])
    closeList(true)
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`${inputClass} flex w-full items-center justify-between gap-2 disabled:pointer-events-none disabled:opacity-40 ${buttonClassName ?? ''}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={event => {
          if (!open) {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              openList()
            }
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex(index => Math.min(options.length - 1, index + 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex(index => Math.max(0, index - 1))
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            choose(activeIndex)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            closeList(true)
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left" style={previewFamily ? { fontFamily: previewFamily(value) } : undefined}>
          {selectedLabel}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={listRef}
          className="absolute right-0 top-[calc(100%+0.375rem)] z-80 max-h-60 min-w-full w-max max-w-72 overflow-auto rounded-xl border border-line bg-surface-raised p-1.5 shadow-menu animate-pop motion-reduce:animate-none"
          role="listbox"
        >
          {options.map(([optionValue, optionLabel], index) => {
            const selected = optionValue === value
            return (
              <button
                key={optionValue}
                type="button"
                role="option"
                aria-selected={selected}
                className={[
                  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-ui-md transition-colors duration-100',
                  selected
                    ? 'bg-accent-soft font-medium text-accent-text'
                    : 'text-ink-soft hover:bg-surface-muted',
                  !selected && index === activeIndex ? 'bg-surface-muted' : '',
                ].join(' ')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                <span className="min-w-0 truncate" style={previewFamily ? { fontFamily: previewFamily(optionValue) } : undefined}>
                  {optionLabel}
                </span>
                {selected ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange(value: string): void; options: Array<[string, string]> }) {
  return (
    <label className="grid gap-1">
      <span className="text-ui-sm font-medium uppercase tracking-wide text-muted">{label}</span>
      <Select value={value} options={options} ariaLabel={label} onChange={onChange} />
    </label>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
      <span className="text-ui-md font-medium text-ink-soft">{label}</span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  )
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 shrink-0 overflow-hidden rounded-full bg-track">
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

function loadConfig(): DemoConfig {
  try {
    return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'))
  } catch {
    return normalizeConfig()
  }
}

function saveConfig(config: DemoConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalizeConfig(config)))
}

function getDemoExtensionState(item: RebookExtensionCatalogItem, config: DemoConfig): {
  installed: boolean
  enabled: boolean
  configured: boolean
  message: string
  settingsSection: SettingsSection
} {
  const { manifest } = item
  const featureControlled = isDemoExtensionFeatureControlled(manifest)
  const featureEnabled = featureControlled
    ? isDemoExtensionFeatureEnabled(manifest, config)
    : item.enabled
  const installed = item.installed || featureEnabled
  const enabled = installed && featureEnabled
  switch (manifest.id) {
    case TRANSLATION_EXTENSION_ID:
      return {
        installed,
        enabled,
        configured: Boolean(config.apiKey.trim()),
        message: config.apiKey.trim()
          ? `Translates to zh-CN in ${config.translateMode} mode.`
          : 'Requires a translation API key and model settings.',
        settingsSection: 'translation',
      }
    case PROFESSIONAL_TRANSLATION_EXTENSION_ID:
      return {
        installed,
        enabled,
        configured: Boolean(config.professionalServiceBaseUrl.trim() && config.professionalBookId.trim()),
        message: config.professionalServiceBaseUrl.trim() && config.professionalBookId.trim()
          ? 'Uses rebook-service professional translation workflow.'
          : 'Requires service URL and book ID.',
        settingsSection: 'translation',
      }
    case TTS_EXTENSION_ID:
      return {
        installed,
        enabled,
        configured: true,
        message: config.ttsMultiSpeaker ? 'Multi-voice TTS is enabled.' : 'Single voice TTS is enabled.',
        settingsSection: 'tts',
      }
    case AI_CHAT_EXTENSION_ID:
      return {
        installed,
        enabled,
        configured: Boolean(config.chatAPIKey.trim()),
        message: config.chatAPIKey.trim()
          ? 'AI chat can search, read, cite, and rewrite the current book.'
          : 'Requires an AI chat API key and model settings.',
        settingsSection: 'chat',
      }
    default:
      return {
        installed,
        enabled,
        configured: true,
        message: 'This marketplace extension is tracked by the demo installer; runtime loading will be handled by a future extension host bridge.',
        settingsSection: 'extensions',
      }
  }
}

function getDemoExtensionContributionBadges(manifest: RebookExtensionManifest): string[] {
  const contributes = manifest.contributes
  const badges: string[] = []
  const commands = contributes?.commands?.length ?? 0
  const panels = contributes?.panels?.length ?? 0
  const settings = Object.keys(contributes?.settings ?? {}).length
  const tools = contributes?.tools?.length ?? 0
  if (commands) badges.push(`${commands} command${commands === 1 ? '' : 's'}`)
  if (panels) badges.push(`${panels} panel${panels === 1 ? '' : 's'}`)
  if (settings) badges.push(`${settings} setting${settings === 1 ? '' : 's'}`)
  if (tools) badges.push(`${tools} tool${tools === 1 ? '' : 's'}`)
  return badges
}

function normalizeConfig(value: Partial<DemoConfig> = {}): DemoConfig {
  const {
    trial: _legacyTrial,
    trialPages: _legacyTrialPages,
    theme: _legacyReaderTheme,
    ...supportedValue
  } = value as Partial<DemoConfig> & { trial?: unknown; trialPages?: unknown; theme?: unknown }
  let config: DemoConfig = {
    ...defaultConfig,
    ...supportedValue,
    reflowablePageFit: normalizeReflowablePageFit(supportedValue.reflowablePageFit),
    extensionInstallations: normalizeDemoExtensionInstallations(supportedValue.extensionInstallations),
  }
  const storedExtensionDefaultsVersion = Number(supportedValue.extensionDefaultsVersion) || 0
  if (storedExtensionDefaultsVersion < BUILT_IN_EXTENSION_DEFAULTS_VERSION) {
    config = {
      ...config,
      chat: true,
      extensionDefaultsVersion: BUILT_IN_EXTENSION_DEFAULTS_VERSION,
    }
  }
  const manager = createDemoExtensionManager(config)
  // Before built-in extensions had explicit installation records, AI Chat was
  // still exposed in the reader toolbar. Migrate that legacy state to the new
  // default: installed and enabled. A recorded disabled installation remains
  // disabled on subsequent loads.
  if (!manager.isInstalled(AI_CHAT_EXTENSION_ID)) {
    config = { ...config, chat: true }
  }
  for (const item of manager.listItems()) {
    const { manifest } = item
    if (!isDemoExtensionFeatureControlled(manifest)) continue
    const featureEnabled = isDemoExtensionFeatureEnabled(manifest, config)
    if (manager.isInstalled(manifest.id)) {
      if (manager.isEnabled(manifest.id) !== featureEnabled) {
        manager.setEnabled(manifest.id, featureEnabled)
      }
    } else {
      manager.install(manifest.id, { enabled: featureEnabled })
    }
  }
  return createDemoConfigWithExtensionManager(config, manager)
}

function normalizeDemoExtensionInstallations(value: unknown): DemoExtensionInstallations {
  if (!value || typeof value !== 'object') return {}
  const installations: DemoExtensionInstallations = {}
  const entries = Array.isArray(value)
    ? value.map(raw => [typeof raw === 'object' && raw && 'id' in raw ? String((raw as { id?: unknown }).id ?? '') : '', raw] as const)
    : Object.entries(value as Record<string, unknown>)
  for (const [key, raw] of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : key.trim()
    if (!id || id === TRIAL_LIMIT_EXTENSION_ID) continue
    installations[id] = {
      id,
      version: typeof entry.version === 'string' ? entry.version : undefined,
      enabled: entry.enabled !== false,
      source: typeof entry.source === 'string' ? entry.source : undefined,
      installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : undefined,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
    }
  }
  return installations
}

function normalizeReflowablePageFit(value: unknown): ReflowablePageFitMode {
  if (value === 'auto' || value === 'paper' || value === 'viewport') return value
  return defaultConfig.reflowablePageFit
}

function isDemoExtensionFeatureControlled(manifest: RebookExtensionManifest): boolean {
  switch (manifest.id) {
    case TRANSLATION_EXTENSION_ID:
    case PROFESSIONAL_TRANSLATION_EXTENSION_ID:
    case TTS_EXTENSION_ID:
    case AI_CHAT_EXTENSION_ID:
      return true
    default:
      return false
  }
}

function isDemoExtensionFeatureEnabled(manifest: RebookExtensionManifest, config: DemoConfig): boolean {
  switch (manifest.id) {
    case TRANSLATION_EXTENSION_ID:
      return config.translate && !config.professionalTranslation
    case PROFESSIONAL_TRANSLATION_EXTENSION_ID:
      return config.translate && config.professionalTranslation
    case TTS_EXTENSION_ID:
      return config.tts
    case AI_CHAT_EXTENSION_ID:
      return config.chat
    default:
      return false
  }
}

function getDemoMarketplaceCatalogParseResult(config: DemoConfig): {
  entries: readonly RebookExtensionCatalogEntry[]
  error: string
} {
  const source = config.extensionCatalogJSON.trim()
  if (!source) return { entries: [], error: '' }
  try {
    return {
      entries: parseRebookExtensionCatalogEntries(JSON.parse(source), { source: 'marketplace' })
        .filter(entry => entry.manifest.id !== TRIAL_LIMIT_EXTENSION_ID),
      error: '',
    }
  } catch (error) {
    return {
      entries: [],
      error: `Catalog JSON is invalid: ${formatError(error)}`,
    }
  }
}

function createDemoExtensionCatalog(config: DemoConfig) {
  const marketplaceCatalog = getDemoMarketplaceCatalogParseResult(config)
  return createRebookExtensionCatalog([
    ...builtInExtensionCatalog.list(),
    ...marketplaceCatalog.entries,
  ].filter(entry => entry.manifest.id !== TRIAL_LIMIT_EXTENSION_ID))
}

function createDemoExtensionManager(config: DemoConfig) {
  return createRebookExtensionManager({
    catalog: createDemoExtensionCatalog(config),
    installations: Object.values(config.extensionInstallations),
  })
}

function getEnabledDemoMarketplaceExtensionItems(config: DemoConfig): readonly RebookExtensionCatalogItem[] {
  return createDemoExtensionManager(config)
    .listItems()
    .filter(item => item.enabled && !isDemoExtensionFeatureControlled(item.manifest))
}

async function loadDemoMarketplaceExtension(entry: RebookExtensionCatalogItem): Promise<RebookExtension> {
  if (!entry.installUrl) {
    throw new Error(`Marketplace extension "${entry.manifest.id}" does not define installUrl.`)
  }
  const moduleUrl = new URL(entry.installUrl, window.location.href).href
  return loadRebookExtensionModule(
    moduleUrl,
    url => import(/* @vite-ignore */ url),
    { catalogEntry: entry },
  )
}

function createDemoConfigWithExtensionManager(config: DemoConfig, manager: ReturnType<typeof createDemoExtensionManager>): DemoConfig {
  return {
    ...config,
    extensionInstallations: extensionInstallationsToRecord(manager.toJSON()),
  }
}

function extensionInstallationsToRecord(installations: readonly RebookExtensionInstallation[]): DemoExtensionInstallations {
  return Object.fromEntries(installations.map(installation => [installation.id, installation]))
}

function installDemoExtension(config: DemoConfig, manifest: RebookExtensionManifest): DemoConfig {
  return setDemoExtensionEnabled(config, manifest, true)
}

function uninstallDemoExtension(config: DemoConfig, manifest: RebookExtensionManifest): DemoConfig {
  const manager = createDemoExtensionManager(config)
  manager.uninstall(manifest.id)
  return setDemoExtensionFeatureEnabled(createDemoConfigWithExtensionManager(config, manager), manifest, false)
}

function setDemoExtensionEnabled(
  config: DemoConfig,
  manifest: RebookExtensionManifest,
  enabled: boolean,
): DemoConfig {
  const manager = createDemoExtensionManager(config)
  if (manager.isInstalled(manifest.id)) {
    manager.setEnabled(manifest.id, enabled)
  } else {
    manager.install(manifest.id, { enabled })
  }
  if (enabled && manifest.id === TRANSLATION_EXTENSION_ID && manager.isInstalled(PROFESSIONAL_TRANSLATION_EXTENSION_ID)) {
    manager.disable(PROFESSIONAL_TRANSLATION_EXTENSION_ID)
  }
  if (enabled && manifest.id === PROFESSIONAL_TRANSLATION_EXTENSION_ID && manager.isInstalled(TRANSLATION_EXTENSION_ID)) {
    manager.disable(TRANSLATION_EXTENSION_ID)
  }
  return setDemoExtensionFeatureEnabled(createDemoConfigWithExtensionManager(config, manager), manifest, enabled)
}

function setDemoExtensionFeatureEnabled(
  config: DemoConfig,
  manifest: RebookExtensionManifest,
  enabled: boolean,
): DemoConfig {
  switch (manifest.id) {
    case TRANSLATION_EXTENSION_ID:
      return enabled
        ? { ...config, translate: true, professionalTranslation: false }
        : config.professionalTranslation
          ? config
          : { ...config, translate: false }
    case PROFESSIONAL_TRANSLATION_EXTENSION_ID:
      return enabled
        ? { ...config, translate: true, professionalTranslation: true }
        : config.professionalTranslation
          ? { ...config, translate: false, professionalTranslation: false }
          : config
    case TTS_EXTENSION_ID:
      return { ...config, tts: enabled }
    case AI_CHAT_EXTENSION_ID:
      return { ...config, chat: enabled }
    default:
      return config
  }
}

function createRebookApiUrl(serviceBaseUrl: string, path: string): string {
  const base = serviceBaseUrl.trim().replace(/\/+$/, '')
  const apiBase = /\/api$/i.test(base) ? base : `${base}/api`
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${apiBase}${suffix}`
}

function getRebookServiceOrigin(serviceBaseUrl: string): string {
  return serviceBaseUrl.trim().replace(/\/+$/, '').replace(/\/api$/i, '')
}

function getChatCommandToken(input: string): string | null {
  const value = input.trimStart()
  if (!value.startsWith('/')) return null
  return /^\/[^\s]*/.exec(value)?.[0].toLowerCase() ?? null
}

function getChatCommandSuggestions(input: string): ChatCommand[] {
  const value = input.trimStart()
  const token = getChatCommandToken(value)
  if (!token) return []
  const exactCommand = CHAT_COMMANDS.find(command => command.name === token)
  const hasArgs = /\s/.test(value.slice(token.length))
  if (exactCommand && hasArgs) return []
  return CHAT_COMMANDS.filter(command => command.name.startsWith(token))
}

function resolveChatCommand(input: string): { prompt?: string; error?: string; insertText?: string } | null {
  const match = /^(\/[^\s]+)(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (!match) return null
  const command = CHAT_COMMANDS.find(item => item.name === match[1].toLowerCase())
  if (!command) return null
  const args = (match[2] ?? '').trim()
  if (command.requiresArgs && !args) {
    return { error: command.missingArgsMessage, insertText: command.insertText }
  }
  return { prompt: command.buildPrompt(args) }
}

interface ChatReferenceToken {
  start: number
  end: number
  query: string
}

function getChatReferenceToken(
  input: string,
  cursorIndex: number,
  selectedReferences: readonly ChatReference[] = [],
): ChatReferenceToken | null {
  const end = Math.max(0, Math.min(input.length, cursorIndex))
  const beforeCursor = input.slice(0, end)
  const start = beforeCursor.lastIndexOf('@')
  if (start < 0) return null
  const previous = input[start - 1]
  if (previous && /[\w.@-]/.test(previous)) return null
  const query = beforeCursor.slice(start + 1)
  if (query.includes('\n') || /^\s/.test(query)) return null
  const normalizedQuery = normalizeReferenceSearchText(query)
  if (selectedReferences.some(reference => {
    const label = normalizeReferenceSearchText(reference.label)
    return normalizedQuery === label || normalizedQuery.startsWith(`${label} `)
  })) {
    return null
  }
  return { start, end, query }
}

function getChatReferenceSuggestions(
  options: readonly ChatReference[],
  selected: readonly ChatReference[],
  query: string,
): ChatReference[] {
  const normalizedQuery = normalizeReferenceSearchText(query)
  const selectedIds = new Set(selected.map(reference => reference.id))
  if (normalizedQuery && selected.some(reference => normalizeReferenceSearchText(reference.label) === normalizedQuery)) {
    return []
  }

  const scored = options
    .filter(reference => !selectedIds.has(reference.id))
    .map((reference, index) => {
      const label = normalizeReferenceSearchText(reference.label)
      const description = normalizeReferenceSearchText(reference.description)
      const excerpt = normalizeReferenceSearchText(reference.excerpt ?? '')
      const searchable = `${label} ${description} ${excerpt}`
      const labelIndex = normalizedQuery ? label.indexOf(normalizedQuery) : 0
      const searchIndex = normalizedQuery ? searchable.indexOf(normalizedQuery) : 0
      if (normalizedQuery && searchIndex < 0) return null
      return {
        reference,
        index,
        score: (reference.kind === 'paragraph' ? 0 : 12)
          + (labelIndex >= 0 ? labelIndex : 80)
          + Math.min(searchIndex, 80),
      }
    })
    .filter((item): item is { reference: ChatReference; index: number; score: number } => item !== null)

  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, MAX_CHAT_REFERENCE_SUGGESTIONS)
    .map(item => item.reference)
}

async function buildChatReferenceOptions(reader: any, book: any): Promise<ChatReference[]> {
  const currentPageReferences = await buildCurrentPageReferenceOptions(reader, book)
  const sectionReferences = buildSectionReferenceOptions(book)
  return dedupeChatReferences([...currentPageReferences, ...sectionReferences]).slice(0, MAX_CHAT_REFERENCE_OPTIONS)
}

function buildSectionReferenceOptions(book: any): ChatReference[] {
  const references: ChatReference[] = []
  const units = getReadableContentUnits(book)
  const tocItems = flattenTOCItems(book.toc ?? [])

  for (const item of tocItems) {
    const unitIndex = resolveReadableContentUnitIndex(book, item.href)
    if (typeof unitIndex !== 'number') continue
    const unit = getReadableContentUnit(book, unitIndex)
    const blockId = getTOCHrefFragment(item.href)
    references.push({
      id: `section:${unitIndex}:${blockId ?? ''}:${item.label}`,
      kind: 'section',
      label: item.label,
      description: unit?.title && unit.title !== item.label
        ? `章节 ${unitIndex + 1} · ${unit.title}`
        : `章节 ${unitIndex + 1}`,
      href: createChatReferenceHref(unitIndex, blockId),
      unitIndex,
      blockId,
      excerpt: unit?.title,
    })
  }

  for (const unit of units) {
    if (!unit.title) continue
    references.push({
      id: `section:${unit.index}:unit`,
      kind: 'section',
      label: unit.title,
      description: unit.kind === 'page' ? `页面 ${unit.index + 1}` : `章节 ${unit.index + 1}`,
      href: createChatReferenceHref(unit.index),
      unitIndex: unit.index,
      excerpt: unit.title,
    })
  }

  return dedupeChatReferences(references)
}

async function buildCurrentPageReferenceOptions(reader: any, book: any): Promise<ChatReference[]> {
  const loc = reader?.getLocation?.()
  const unitIndex = typeof loc?.index === 'number' ? loc.index : 0
  const unit = getReadableContentUnit(book, unitIndex)
  const chunks = await reader?.getCurrentText?.()
  if (!Array.isArray(chunks) || !chunks.length) return []

  const groups = new Map<string, { blockId?: string; texts: string[]; order: number }>()
  chunks.forEach((chunk: any, index: number) => {
    const text = normalizeReferenceText(chunk?.text ?? '')
    if (!text) return
    const blockId = chunk?.location?.type === 'reflowable' ? chunk.location.blockId : undefined
    const key = blockId ? `block:${blockId}` : `chunk:${index}`
    const group: { blockId?: string; texts: string[]; order: number } =
      groups.get(key) ?? { blockId, texts: [], order: index }
    group.texts.push(text)
    groups.set(key, group)
  })

  return Array.from(groups.values())
    .sort((a, b) => a.order - b.order)
    .map((group): ChatReference | null => {
      const excerpt = clipChatReferenceExcerpt(joinReferenceText(group.texts))
      if (!excerpt || excerpt.length < 2) return null
      const label = excerpt.length > 32 ? `${excerpt.slice(0, 32)}...` : excerpt
      return {
        id: `paragraph:${unitIndex}:${group.blockId ?? group.order}`,
        kind: 'paragraph',
        label,
        description: unit?.title ? `当前页 · ${unit.title}` : `当前页 · ${unitIndex + 1}`,
        href: createChatReferenceHref(unitIndex, group.blockId),
        unitIndex,
        blockId: group.blockId,
        excerpt,
      }
    })
    .filter((reference): reference is ChatReference => reference !== null)
}

function buildChatMessageContentWithReferences(content: string, references: readonly ChatReference[]): string {
  if (!references.length) return content
  const base = content.trim() || '请结合我引用的内容回答。'
  const referenceText = references.map((reference, index) => [
    `${index + 1}. ${reference.kind === 'section' ? '章节' : '段落'}：${reference.label}`,
    `href: ${reference.href}`,
    reference.description ? `位置: ${reference.description}` : '',
    reference.excerpt ? `摘录: ${reference.excerpt}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  return [
    base,
    '用户在输入框中引用了以下书籍位置。回答涉及这些引用内容时，请优先使用对应 href 作为出处链接：',
    referenceText,
  ].join('\n\n')
}

function dedupeChatReferences(references: readonly ChatReference[]): ChatReference[] {
  const seen = new Set<string>()
  const next: ChatReference[] = []
  for (const reference of references) {
    const key = `${reference.href}\n${normalizeReferenceSearchText(reference.label)}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(reference)
  }
  return next
}

function createChatReferenceHref(unitIndex: number, blockId?: string): string {
  return blockId ? `rebook://j/${unitIndex}/${encodeURIComponent(blockId)}` : `rebook://j/${unitIndex}`
}

function getTOCHrefFragment(href: string | undefined): string | undefined {
  if (!href) return undefined
  const index = href.indexOf('#')
  if (index < 0 || index === href.length - 1) return undefined
  try {
    return decodeURIComponent(href.slice(index + 1))
  } catch {
    return href.slice(index + 1)
  }
}

function normalizeReferenceSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function normalizeReferenceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function joinReferenceText(parts: readonly string[]): string {
  let output = ''
  for (const part of parts) {
    if (!part) continue
    if (!output) {
      output = part
      continue
    }
    output += shouldJoinReferenceTextWithSpace(output, part) ? ` ${part}` : part
  }
  return output
}

function shouldJoinReferenceTextWithSpace(left: string, right: string): boolean {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)
}

function clipChatReferenceExcerpt(value: string): string {
  return value.length > MAX_CHAT_REFERENCE_EXCERPT
    ? `${value.slice(0, MAX_CHAT_REFERENCE_EXCERPT).trimEnd()}...`
    : value
}

interface RebookJumpTarget {
  unitIndex: number
  blockId?: string
}

function isRebookJumpHref(href: string): boolean {
  return href.startsWith('rebook://j/')
}

function transformChatMarkdownUrl(value: string): string {
  if (isRebookJumpHref(value)) return value
  return defaultUrlTransform(value)
}

function parseRebookJumpHref(href: string): RebookJumpTarget | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'rebook:' || url.hostname !== 'j') return null
    const [rawUnitIndex, ...rawBlockParts] = url.pathname.split('/').filter(Boolean)
    const unitIndex = Number(rawUnitIndex)
    if (!Number.isInteger(unitIndex) || unitIndex < 0) return null
    const rawBlockId = rawBlockParts.join('/')
    return {
      unitIndex,
      blockId: rawBlockId ? decodeURIComponent(rawBlockId) : undefined,
    }
  } catch {
    return null
  }
}

function toAIChatMessage(message: ChatMessage) {
  if (message.role !== 'user' || !message.attachments?.length) {
    return { role: message.role, content: message.content }
  }
  return {
    role: message.role,
    content: [
      { type: 'text', text: message.content || '请分析这些图片。' },
      ...message.attachments.map(attachment => ({
        type: 'image',
        image: attachment.data,
        mediaType: attachment.mediaType,
      })),
    ],
  }
}

async function readChatImageAttachment(file: File): Promise<ChatAttachment> {
  const dataUrl = await readFileAsDataURL(file)
  const base64 = dataUrl.split(',')[1] || ''
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name || 'image',
    mediaType: file.type || 'image/png',
    data: base64,
    previewUrl: URL.createObjectURL(file),
  }
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read image.'))
    reader.readAsDataURL(file)
  })
}

function revokeChatAttachmentURLs(attachments: readonly ChatAttachment[]) {
  attachments.forEach(attachment => URL.revokeObjectURL(attachment.previewUrl))
}

interface MarkdownNode {
  type?: string
  value?: string
  children?: MarkdownNode[]
}

function remarkLooseStrong() {
  return (tree: MarkdownNode) => {
    normalizeLooseStrong(tree)
  }
}

function normalizeLooseStrong(node: MarkdownNode) {
  if (!node.children?.length) return
  const nextChildren: MarkdownNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      nextChildren.push(...splitLooseStrongText(child.value))
      continue
    }
    normalizeLooseStrong(child)
    nextChildren.push(child)
  }
  node.children = nextChildren
}

function splitLooseStrongText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let cursor = 0
  let changed = false

  while (cursor < value.length) {
    const start = value.indexOf('**', cursor)
    if (start === -1) break
    const end = value.indexOf('**', start + 2)
    if (end === -1) break
    const strongText = value.slice(start + 2, end)
    if (!strongText.trim()) {
      break
    }
    if (start > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, start) })
    }
    nodes.push({
      type: 'strong',
      children: [{ type: 'text', value: strongText }],
    })
    changed = true
    cursor = end + 2
  }

  if (!changed) return [{ type: 'text', value }]
  if (cursor < value.length) {
    nodes.push({ type: 'text', value: value.slice(cursor) })
  }
  return nodes
}

function getReaderStyles(config: DemoConfig, appTheme: 'light' | 'dark'): RendererStyles {
  return {
    theme: appTheme === 'dark' ? 'night' : 'normal',
    fontSize: config.fontSize,
    fontFamilies: getReaderFontFamilies(config),
    overrideBookFonts: config.overrideBookFonts,
    hyphenate: config.hyphenate,
    lineHeight: 1.72,
    minColumnWidth: '360px',
    maxColumnWidth: '960px',
    margin: '44px',
    reflowablePageFit: config.reflowablePageFit,
  }
}

function getCurrentChatContext(reader: any, book: any) {
  const loc = reader?.getLocation?.()
  const unitIndex = typeof loc?.index === 'number' ? loc.index : 0
  const unit = book ? getReadableContentUnit(book, unitIndex) : undefined
  return {
    unitIndex,
    unitId: unit?.id,
    unitKind: unit?.kind,
    unitTitle: unit?.title ?? loc?.tocItem?.label,
    sectionIndex: unit?.sectionIndex,
    sectionId: unit?.kind === 'section' ? unit.id : undefined,
    sectionTitle: unit?.kind === 'section' ? unit.title ?? loc?.tocItem?.label : undefined,
    tocLabel: loc?.tocItem?.label,
    tocHref: loc?.tocItem?.href,
    sectionFraction: typeof loc?.fraction === 'number' ? loc.fraction : undefined,
    totalFraction: typeof loc?.totalFraction === 'number' ? loc.totalFraction : undefined,
    pageIndex: typeof loc?.pageIndex === 'number' ? loc.pageIndex : undefined,
    pageCount: typeof loc?.pageCount === 'number' ? loc.pageCount : undefined,
  }
}

function createTTSVoiceProfile(config: DemoConfig) {
  if (isMimoTTSProvider(config)) {
    const narrator = normalizeMimoVoice(config.ttsNarratorVoice || config.ttsVoice)
    return { narrator, unknown: narrator, other: narrator }
  }
  return {
    narrator: config.ttsNarratorVoice.trim() || undefined,
    male: splitVoiceList(config.ttsMaleVoices),
    female: splitVoiceList(config.ttsFemaleVoices),
    other: config.ttsOtherVoice.trim() || undefined,
    unknown: config.ttsOtherVoice.trim() || config.ttsNarratorVoice.trim() || undefined,
  }
}

function getTTSVoiceValue(config: DemoConfig) {
  return isMimoTTSProvider(config)
    ? normalizeMimoVoice(config.ttsVoice)
    : (config.ttsVoice.trim() || undefined)
}

function isMimoTTSProvider(config: DemoConfig) {
  return (config.ttsProvider.trim() || defaultConfig.ttsProvider).toLowerCase() === 'mimo'
}

function normalizeMimoVoice(value: string, fallback = 'mimo_default') {
  const voice = value.trim()
  if (!voice || /Neural$/i.test(voice) || /^(?:zh|en)-[A-Z]{2}-/i.test(voice)) return fallback
  return voice
}

function splitVoiceList(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function formatLanguageMap(value: any): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value['zh-CN'] || value.zh || value.en || Object.values(value)[0] as string || ''
}

function formatBookContributors(value: any): string {
  if (!value) return ''
  const contributors = Array.isArray(value) ? value : [value]
  return contributors.map((contributor: any) => {
    if (typeof contributor === 'string') return contributor.trim()
    return formatLanguageMap(contributor?.name).trim()
  }).filter(Boolean).join(', ')
}

function titleFromBookFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '未命名书籍'
}

function flattenTOCItems(items: any[]): any[] {
  return items.flatMap(item => item.subitems?.length ? [item, ...flattenTOCItems(item.subitems)] : [item])
}

function summarizeLocation(location: any) {
  if (!location) return null
  return {
    index: location.index,
    fraction: location.fraction,
    totalFraction: location.totalFraction,
    tocLabel: location.tocItem?.label,
    reason: location.reason,
  }
}

function createShelfLocator(location: any) {
  return {
    unitIndex:
      typeof location?.index === 'number' ? location.index : undefined,
    fraction:
      typeof location?.fraction === 'number' ? location.fraction : undefined,
    totalFraction:
      typeof location?.totalFraction === 'number'
        ? location.totalFraction
        : undefined,
    tocLabel:
      typeof location?.tocItem?.label === 'string'
        ? location.tocItem.label
        : undefined,
  }
}

let rebookDebugBridgeTools: RebookDebugTools | null = null
let rebookDebugBridgeInstalled = false

function installRebookDebugBridge(tools: RebookDebugTools): void {
  rebookDebugBridgeTools = tools
  if (typeof document === 'undefined') return
  document.documentElement.dataset.rebookDebugTools = 'true'
  ensureRebookDebugBridgeOutput()
  if (rebookDebugBridgeInstalled) return

  document.addEventListener('rebook-debug-command', () => {
    void handleRebookDebugBridgeCommand()
  })
  rebookDebugBridgeInstalled = true
}

async function handleRebookDebugBridgeCommand(): Promise<void> {
  const output = ensureRebookDebugBridgeOutput()
  const rawCommand = document.documentElement.dataset.rebookDebugCommand
  if (!rawCommand) return

  let request: { id?: string; command?: string; args?: unknown[] }
  try {
    request = JSON.parse(rawCommand)
  } catch (error) {
    writeRebookDebugBridgeResult(output, {
      id: null,
      ok: false,
      error: `Invalid debug command: ${formatError(error)}`,
    })
    return
  }

  const id = request.id ?? String(Date.now())
  try {
    const result = await invokeRebookDebugCommand(request.command ?? '', request.args ?? [])
    writeRebookDebugBridgeResult(output, { id, ok: true, result })
  } catch (error) {
    writeRebookDebugBridgeResult(output, { id, ok: false, error: formatError(error) })
  }
}

async function invokeRebookDebugCommand(command: string, args: unknown[]): Promise<unknown> {
  const tools = rebookDebugBridgeTools
  if (!tools) throw new Error('Rebook debug tools are not ready.')

  switch (command) {
    case 'help':
      return tools.help()
    case 'figures':
    case 'scanFigures':
      return tools.scanFigures()
    case 'logFigures':
      return tools.logFigures()
    case 'copyFigures':
      return tools.copyFigures()
    case 'go':
      return tools.go(toDebugTarget(args[0]))
    case 'next':
      return tools.next()
    case 'prev':
      return tools.prev()
    case 'goTo':
      return tools.goTo(toDebugTarget(args[0]))
    case 'refresh':
      return tools.refresh()
    case 'scan':
      return tools.scan(isDebugScanOptions(args[0]) ? args[0] : undefined)
    case 'scanPages':
      return tools.scanPages(isDebugScanOptions(args[0]) ? args[0] : undefined)
    case 'find':
      return tools.find(typeof args[0] === 'number' ? args[0] : undefined)
    case 'findFigureIssues':
      return tools.findFigureIssues(typeof args[0] === 'number' ? args[0] : undefined)
    case 'sections':
    case 'toc':
      return tools.sections()
    case 'block':
      return tools.block(String(args[0] ?? ''))
    case 'jumpToBlock':
      await tools.jumpToBlock(String(args[0] ?? ''))
      return tools.scanFigures()
    case 'location':
    case 'getLocation':
      return tools.getLocation()
    default:
      throw new Error(`Unknown debug command: ${command}`)
  }
}

function toDebugTarget(value: unknown): string | number {
  if (typeof value === 'number' || typeof value === 'string') return value
  throw new Error('goTo requires a string or number target.')
}

function isDebugScanOptions(value: unknown): value is ReflowDebugScanOptions {
  if (!value || typeof value !== 'object') return false
  const options = value as { direction?: unknown }
  return options.direction == null || options.direction === 'next' || options.direction === 'prev'
}

function ensureRebookDebugBridgeOutput(): HTMLTextAreaElement {
  const existing = document.getElementById('rebook-debug-bridge-output')
  if (existing instanceof HTMLTextAreaElement) return existing

  const output = document.createElement('textarea')
  output.id = 'rebook-debug-bridge-output'
  output.dataset.rebookDebugOutput = 'true'
  output.setAttribute('aria-hidden', 'true')
  output.tabIndex = -1
  output.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(output)
  return output
}

function writeRebookDebugBridgeResult(output: HTMLTextAreaElement, result: unknown): void {
  output.value = safeStringify(result)
  output.dataset.updatedAt = String(Date.now())
  document.dispatchEvent(new CustomEvent('rebook-debug-result'))
}

function createReflowDebugSnapshot(root: HTMLElement | null): ReflowDebugSnapshot {
  const scope = root ?? document.body
  const frame = scope.querySelector<HTMLElement>('[data-page-index]')
  const frameRect = frame?.getBoundingClientRect()
  const lines = Array.from(scope.querySelectorAll<HTMLElement>('[data-rebook-block="true"]'))
    .map((element, index) => readReflowDebugLine(element, index))
    .sort((a, b) => a.lineIndex - b.lineIndex)
  const captions = lines.filter(isReflowDebugCaption)
  const images = lines.filter(line => line.blockType === 'image')
  const maxLineIndex = lines[lines.length - 1]?.lineIndex ?? -1
  const pairs = images.map(image => createReflowDebugFigurePair(image, captions, maxLineIndex))
  const rowRange = lines.length
    ? [lines[0]!.lineIndex, lines[lines.length - 1]!.lineIndex] as [number, number]
    : null

  return {
    pageIndex: parseNullableNumber(frame?.dataset.pageIndex),
    location: null,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    frame: frameRect
      ? {
        x: frameRect.x,
        y: frameRect.y,
        width: frameRect.width,
        height: frameRect.height,
      }
      : null,
    rowRange,
    pairs,
    issues: pairs.filter(pair => pair.issue),
  }
}

function readReflowDebugLine(element: HTMLElement, index: number): ReflowDebugLine {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return {
    lineIndex: index,
    blockId: element.dataset.blockId ?? null,
    blockType: element.dataset.blockType ?? null,
    sourceTop: null,
    sourceHeight: null,
    styleTop: parseCSSPixelValue(style.top),
    styleLeft: parseCSSPixelValue(style.left),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
    },
    text: normalizeDebugText(element.textContent ?? ''),
    imageSrc: element.querySelector('img')?.getAttribute('src') ?? null,
  }
}

function createReflowDebugFigurePair(
  image: ReflowDebugLine,
  captions: ReflowDebugLine[],
  maxLineIndex: number,
): ReflowDebugFigurePair {
  const caption = captions.find(item => item.lineIndex > image.lineIndex) ?? null
  const lineDistance = caption ? caption.lineIndex - image.lineIndex : Number.POSITIVE_INFINITY
  const visualGap = caption ? caption.rect.y - image.rect.bottom : null
  let issue: ReflowDebugIssueKind | null = null

  if ((!caption && maxLineIndex - image.lineIndex > 12) || lineDistance > 12) {
    issue = 'missing-caption'
  } else if (visualGap != null && visualGap < -2) {
    issue = 'caption-before-image'
  } else if (visualGap != null && visualGap > 96) {
    issue = 'distant-caption'
  }

  return {
    image,
    caption,
    visualGap,
    issue,
  }
}

function isReflowDebugCaption(line: ReflowDebugLine): boolean {
  return /^fig(?:ure)?\.?\s*\d+[\s.:]/i.test(line.text)
}

function summarizeReflowDebugSnapshot(snapshot: ReflowDebugSnapshot) {
  return {
    pageIndex: snapshot.pageIndex,
    location: snapshot.location,
    viewport: snapshot.viewport,
    rowRange: snapshot.rowRange,
    figures: snapshot.pairs.length,
    issues: snapshot.issues.map(pair => ({
      issue: pair.issue,
      imageLine: pair.image.lineIndex,
      imageBlock: pair.image.blockId,
      captionLine: pair.caption?.lineIndex ?? null,
      captionBlock: pair.caption?.blockId ?? null,
      caption: pair.caption?.text ?? null,
      visualGap: pair.visualGap,
      imageRect: pair.image.rect,
      captionRect: pair.caption?.rect ?? null,
      sourceTop: {
        image: pair.image.sourceTop,
        caption: pair.caption?.sourceTop ?? null,
      },
    })),
  }
}

function summarizeDebugSections(book: any) {
  const sections = (book?.sections ?? []).map((section: any, index: number) => ({
    index,
    id: section?.id,
    title: formatLanguageMap(section?.title ?? section?.label),
    href: section?.href,
  }))
  const toc = flattenTOCItems(book?.toc ?? []).map((item: any) => {
    const resolved = book?.resolveHref?.(item.href)
    return {
      label: item.label,
      href: item.href,
      index: resolved?.index ?? null,
      anchor: resolved?.anchor ?? null,
    }
  })
  return { sections, toc }
}

function parseCSSPixelValue(value: string): number | null {
  return parseNullableNumber(value.replace(/px$/, ''))
}

function parseNullableNumber(value: string | undefined | null): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeDebugText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function waitForDebugRender(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        requestAnimationFrame(() => resolve())
      }, 120)
    })
  })
}

function formatProgress(location: any) {
  const value = typeof location?.totalFraction === 'number' ? location.totalFraction : 0
  return `${Math.round(value * 100)}%`
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatMs(value: number) {
  if (value < 10) return `${value.toFixed(2)}ms`
  if (value < 100) return `${value.toFixed(1)}ms`
  return `${Math.round(value)}ms`
}

function clampPanelWidth(value: string | number) {
  const number = typeof value === 'number' ? value : Number(value)
  const viewportMax = typeof window === 'undefined' ? 1120 : Math.max(420, window.innerWidth - 160)
  return Math.max(320, Math.min(1120, viewportMax, Number.isFinite(number) ? number : 420))
}

function getKeyboardPageDirection(event: KeyboardEvent): 'next' | 'prev' | null {
  if (event.shiftKey) return null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') return 'next'
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') return 'prev'
  return null
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const editable = target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')
  return Boolean(editable)
}

function panelButtonClass(active: boolean) {
  return active
    ? `${toolbarButtonClass} bg-accent-soft text-accent-text ring-1 ring-accent-softer`
    : toolbarButtonClass
}

function sidebarToolButtonClass(active: boolean) {
  return active
    ? `${iconButtonClass} bg-accent-soft text-accent-text ring-1 ring-accent-softer`
    : iconButtonClass
}

export default ReaderWorkspace
