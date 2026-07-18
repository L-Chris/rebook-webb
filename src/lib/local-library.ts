import type { ShelfItem } from './api'
import { createClientUUID } from './client-id'
import {
  BrowserDOMAdapter,
  BrowserURLFactory,
  registerBuiltInParsers,
  registry,
  type Book,
  type BookMetadata,
  type Contributor,
  type LanguageMap,
} from 'rebook'
import { createBrowserFixedPdfCanvasRenderer } from 'rebook/renderers/browser'

const DATABASE_NAME = 'rebook-local-library'
const DATABASE_VERSION = 1
const BOOK_STORE = 'books'
const LOCAL_BOOK_PREFIX = 'local-'

type LocalBookRecord = {
  id: string
  title: string
  author: string | null
  sourceType: string
  status: string
  progress: number
  locator: ShelfItem['locator']
  addedAt: string
  updatedAt: string
  lastReadAt: string | null
  fileName: string
  fileSize: number
  mimeType: string
  file: Blob
  cover?: Blob | null
}

export type LocalBook = {
  item: ShelfItem
  file: File
}

export type LocalBookMetadata = {
  title: string
  author: string | null
  cover: Blob | null
}

registerBuiltInParsers(registry)

const parserOptions = {
  domAdapter: new BrowserDOMAdapter(),
  urlFactory: new BrowserURLFactory(),
}

export function isLocalBookId(id: string) {
  return id.startsWith(LOCAL_BOOK_PREFIX)
}

export async function importLocalBook(file: File): Promise<ShelfItem> {
  const now = new Date().toISOString()
  const metadata = await extractLocalBookMetadata(file)
  const record: LocalBookRecord = {
    id: `${LOCAL_BOOK_PREFIX}${createClientUUID()}`,
    title: metadata.title,
    author: metadata.author,
    sourceType: extensionFromFileName(file.name) || 'ebook',
    status: 'reading',
    progress: 0,
    locator: null,
    addedAt: now,
    updatedAt: now,
    lastReadAt: null,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    file,
    cover: metadata.cover,
  }
  await putRecord(record)
  return toShelfItem(record)
}

export async function listLocalBooks(query = ''): Promise<ShelfItem[]> {
  const records = await getAllRecords()
  const needle = query.trim().toLocaleLowerCase()
  const filtered = records
    .filter(record => !needle
      || record.title.toLocaleLowerCase().includes(needle)
      || record.author?.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return Promise.all(filtered.map(toShelfItem))
}

export async function getLocalBook(id: string): Promise<LocalBook | null> {
  const record = await getRecord(id)
  if (!record) return null
  return {
    item: await toShelfItem(record),
    file: new File([record.file], record.fileName, { type: record.mimeType }),
  }
}

export async function updateLocalBookMetadata(
  id: string,
  metadata: Partial<LocalBookMetadata>,
) {
  const record = await getRecord(id)
  if (!record) return
  if (metadata.title?.trim()) record.title = metadata.title.trim()
  if (metadata.author !== undefined) record.author = metadata.author?.trim() || null
  if (metadata.cover !== undefined) record.cover = metadata.cover
  record.updatedAt = new Date().toISOString()
  await putRecord(record)
}

export async function updateLocalBookProgress(
  id: string,
  progress: number,
  locator: ShelfItem['locator'],
) {
  const record = await getRecord(id)
  if (!record) return
  const now = new Date().toISOString()
  record.progress = Math.max(0, Math.min(1, progress))
  record.locator = locator
  record.lastReadAt = now
  record.updatedAt = now
  await putRecord(record)
}

export async function removeLocalBook(id: string) {
  const database = await openDatabase()
  await transactionPromise(database, 'readwrite', store => store.delete(id))
}

async function toShelfItem(record: LocalBookRecord): Promise<ShelfItem> {
  return {
    id: record.id,
    title: record.title,
    author: record.author,
    language: null,
    sourceType: record.sourceType,
    sourceFileName: record.fileName,
    status: record.status,
    progress: record.progress,
    locator: record.locator,
    lastReadAt: record.lastReadAt,
    finishedAt: null,
    addedAt: record.addedAt,
    updatedAt: record.updatedAt,
    coverUrl: record.cover ? await blobToDataUrl(record.cover) : null,
    fileName: record.fileName,
    fileSize: record.fileSize,
    storageProvider: 'local',
  }
}

async function extractLocalBookMetadata(file: File): Promise<LocalBookMetadata> {
  const fallback: LocalBookMetadata = {
    title: titleFromFileName(file.name),
    author: null,
    cover: null,
  }
  try {
    const book = await registry.open(file, parserOptions)
    try {
      const parsedTitle = formatLanguageMap(book.metadata?.title).trim()
      const title = parsedTitle && parsedTitle !== file.name ? parsedTitle : fallback.title
      const author = formatContributors(book.metadata?.author) || null
      const cover = await extractBookCover(book)
      return { title, author, cover }
    } finally {
      book.destroy?.()
    }
  } catch {
    return fallback
  }
}

export async function extractBookCover(book: Book): Promise<Blob | null> {
  if (book.getCover) {
    try {
      const cover = await book.getCover()
      if (cover) return cover
    } catch {
      // Fixed-layout formats can still provide a rendered first-page cover.
    }
  }

  const document = book.fixedDocument
  if (document?.format !== 'pdf' || document.pageCount < 1) return null

  const page = await document.getPage(0)
  const scale = Math.min(1, 360 / page.width, 540 / page.height)
  const canvas = window.document.createElement('canvas')
  const renderer = createBrowserFixedPdfCanvasRenderer({ background: '#ffffff' })
  try {
    await renderer.renderPage(document, canvas, 0, {
      intent: 'thumbnail',
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      devicePixelRatio: 1,
      textLayer: false,
    })
    return await canvasToBlob(canvas, 'image/webp', 0.86)
      || await canvasToBlob(canvas, 'image/png')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function formatContributors(value: BookMetadata['author']): string {
  if (!value) return ''
  const contributors = Array.isArray(value) ? value : [value]
  return contributors.map(formatContributor).filter(Boolean).join(', ')
}

function formatContributor(value: Contributor): string {
  if (typeof value === 'string') return value.trim()
  return formatLanguageMap(value.name).trim()
}

function formatLanguageMap(value?: LanguageMap): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value['zh-CN'] || value.zh || value.en || Object.values(value)[0] || ''
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('无法读取封面'))
    reader.readAsDataURL(blob)
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '未命名书籍'
}

function extensionFromFileName(fileName: string) {
  return fileName.toLocaleLowerCase().match(/\.([^.]+)$/)?.[1] || ''
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(BOOK_STORE)) {
        database.createObjectStore(BOOK_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开本地书库'))
  })
}

async function getRecord(id: string): Promise<LocalBookRecord | null> {
  const database = await openDatabase()
  return transactionPromise(database, 'readonly', store => store.get(id))
    .then(value => (value as LocalBookRecord | undefined) || null)
}

async function getAllRecords(): Promise<LocalBookRecord[]> {
  const database = await openDatabase()
  return transactionPromise(database, 'readonly', store => store.getAll())
    .then(value => value as LocalBookRecord[])
}

async function putRecord(record: LocalBookRecord) {
  const database = await openDatabase()
  await transactionPromise(database, 'readwrite', store => store.put(record))
}

function transactionPromise(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BOOK_STORE, mode)
    const request = run(transaction.objectStore(BOOK_STORE))
    let result: unknown
    request.onsuccess = () => {
      result = request.result
    }
    request.onerror = () => {
      database.close()
      reject(request.error || new Error('本地书库操作失败'))
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || new Error('本地书库操作失败'))
    }
  })
}
