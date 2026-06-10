// Chat persistence — localStorage helpers for the agent chat thread (P20).
// Each paper gets its own chat thread keyed by paper ID.

import type { ChatThread } from './types'

const CHAT_KEY_PREFIX = 'ars_chat_'

function chatKey(paperId: string): string {
  return `${CHAT_KEY_PREFIX}${paperId}`
}

export function loadChatThread(paperId: string): ChatThread {
  if (typeof window === 'undefined') return { messages: [], pendingInstructions: [] }
  try {
    const raw = localStorage.getItem(chatKey(paperId))
    if (!raw) return { messages: [], pendingInstructions: [] }
    const parsed = JSON.parse(raw)
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      pendingInstructions: Array.isArray(parsed.pendingInstructions) ? parsed.pendingInstructions : [],
    }
  } catch {
    return { messages: [], pendingInstructions: [] }
  }
}

export function saveChatThread(paperId: string, thread: ChatThread): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(chatKey(paperId), JSON.stringify(thread))
}

export function clearChatThread(paperId: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(chatKey(paperId))
}

export function addPendingInstruction(paperId: string, instruction: string): void {
  const thread = loadChatThread(paperId)
  thread.pendingInstructions.push(instruction)
  saveChatThread(paperId, thread)
}

export function consumePendingInstructions(paperId: string): string[] {
  const thread = loadChatThread(paperId)
  const instructions = [...thread.pendingInstructions]
  thread.pendingInstructions = []
  saveChatThread(paperId, thread)
  return instructions
}
