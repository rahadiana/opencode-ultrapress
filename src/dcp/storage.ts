/**
 * DCP Storage — JSON-persisted compression state per session.
 *
 * Saves original message content so placeholders in the LLM context
 * can be expanded back to full content on demand.
 *
 * Storage path: ~/.config/opencode/ultrapress/storage/{sessionId}.json
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

import type { CompressionBlock } from "./compress-state.js"

const STORAGE_DIR = join(homedir(), ".config", "opencode", "ultrapress", "storage")

export interface CompressedMessageEntry {
  /** Replacement placeholder text for the message */
  placeholder: string
  /** Original content of the message (for restoration) */
  originalContent?: string
  /** Original parts of the message (for restoration) */
  originalParts?: any[]
}

export interface SessionStorage {
  version: number
  sessionId: string
  blocks: CompressionBlock[]
  compressedMessages: Record<string, CompressedMessageEntry>
  lastSavedAt: number
}

const CURRENT_VERSION = 1

async function ensureStorageDir(): Promise<void> {
  try {
    await mkdir(STORAGE_DIR, { recursive: true })
  } catch {
    // directory exists
  }
}

function storagePath(sessionId: string): string {
  return join(STORAGE_DIR, `${sessionId}.json`)
}

/**
 * Load session state from disk. Returns null if no saved state exists.
 */
export async function loadSessionState(sessionId: string): Promise<SessionStorage | null> {
  try {
    const raw = await readFile(storagePath(sessionId), "utf-8")
    const data = JSON.parse(raw) as SessionStorage
    if (data.version !== CURRENT_VERSION) return null
    return data
  } catch {
    return null
  }
}

/**
 * Save session state to disk.
 */
export async function saveSessionState(sessionId: string, state: SessionStorage): Promise<void> {
  await ensureStorageDir()
  state.lastSavedAt = Date.now()
  await writeFile(storagePath(sessionId), JSON.stringify(state, null, 2), "utf-8")
}

/**
 * Create a fresh session storage object.
 */
export function createSessionStorage(sessionId: string): SessionStorage {
  return {
    version: CURRENT_VERSION,
    sessionId,
    blocks: [],
    compressedMessages: {},
    lastSavedAt: Date.now(),
  }
}
