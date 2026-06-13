'use client'

// AgentChatPanel — the orchestrator CONVERSATION pane (P20 chat, promoted in FP-2).
//
// FP-2 turns the old floating-collapsed chat into the centre of the "Agent Studio": on wide
// screens (lg+) it renders as a PERSISTENT docked column; below lg it falls back to the P20
// floating panel so mobile still has chat (the P19.7 responsive discipline).
//
// Two channels share this one thread:
//   • the AGENT conversation — the user ↔ assistant chat (role 'user' / 'assistant'), plus
//     FP-1 agent notes / stripped commentary / errors posted by the stage pages.
//   • the ORCHESTRATOR narrator — local, no-LLM 'narrator' messages produced by
//     reconcileNarrator(): a "Stage X started…" announcement and a Decision-Dashboard CARD at
//     every checkpoint. The card's action only NAVIGATES to the page that owns the real,
//     guarded control — it never clears a gate, so blocking gates stay unbypassable.
//
// Narrator messages are UI-only: they are filtered out of the /api/chat request so they never
// pollute the model's context. The thread (including narrator cards) persists in localStorage
// via chat-persistence, so a reload restores the full conversation.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { streamAgentChat, type ChatContext, type ChatRequestMessage } from '@/lib/agent-chat'
import { loadChatThread, saveChatThread, addPendingInstruction } from '@/lib/chat-persistence'
import { reconcileNarrator } from '@/lib/orchestrator-narrator'
import { pipelineStatusLabel } from '@/lib/pipeline-router'
import { loadModelConfig } from '@/lib/storage'
import type { ChatMessage, ChatThread, ModelConfig, PaperState } from '@/lib/types'

interface Props {
  paperId: string
  paper: PaperState | null
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function AgentChatPanel({ paperId, paper }: Props) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false) // floating-mode open/close (mobile/tablet)
  const [thread, setThread] = useState<ChatThread>({ messages: [], pendingInstructions: [] })
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [mounted, setMounted] = useState(false)
  const [isWide, setIsWide] = useState(false)
  // Gate the narrator until the saved thread has loaded from localStorage — otherwise its
  // first reconcile would run against the empty initial thread and saveChatThread() would
  // CLOBBER the persisted conversation on reload.
  const [hydrated, setHydrated] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)
  // Latest-thread ref so the narrator reconcile + send handler always fold into the freshest
  // thread (the layout re-polls `paper` every 1.5s — we must not clobber in-flight messages).
  const threadRef = useRef<ChatThread>(thread)
  useEffect(() => {
    threadRef.current = thread
  }, [thread])

  // Chat context derived from the paper (read by /api/chat as grounding).
  const context: ChatContext = useMemo(
    () => ({
      topic: paper?.config?.topic,
      paperType: paper?.config?.paperType,
      outline: paper?.outline,
      completedSections: paper?.sections
        ?.filter((s) => s.status === 'done' || s.status === 'edited')
        .map((s) => `## ${s.heading}\n${s.content}`),
      currentStage: paper?.pipelineStatus ? pipelineStatusLabel(paper.pipelineStatus) : undefined,
    }),
    [paper],
  )

  // Load saved thread + model config on mount.
  useEffect(() => {
    modelConfigRef.current = loadModelConfig()
    const panelState = localStorage.getItem('ars_chat_panel_open')
    queueMicrotask(() => {
      const saved = loadChatThread(paperId)
      threadRef.current = saved
      setThread(saved)
      if (panelState === 'true') setIsOpen(true)
      setHydrated(true)
    })
  }, [paperId])

  // Responsive mode: docked column on lg+ (>=1024px), floating panel below.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsWide(mq.matches)
    // Defer the initial setState out of the synchronous effect body (repo lint rule,
    // P8 BUG-5). The 'change' handler below sets state in a subscription callback, which is
    // the allowed pattern.
    queueMicrotask(() => {
      setMounted(true)
      setIsWide(mq.matches)
    })
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Orchestrator narrator: when the paper's derived status reaches a new checkpoint, append the
  // single announcement/Decision-Dashboard message for it. Idempotent (stable id) — safe to run
  // on every 1.5s paper poll; it appends at most once per checkpoint.
  useEffect(() => {
    if (!paper || !hydrated) return
    const updated = reconcileNarrator(threadRef.current, paper)
    if (updated) {
      threadRef.current = updated
      setThread(updated)
      saveChatThread(paperId, updated)
    }
  }, [paper, paperId, hydrated])

  // Auto-scroll to bottom on new messages / streaming.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [thread.messages, streamingText])

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      localStorage.setItem('ars_chat_panel_open', String(next))
      return next
    })
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      stage: context.currentStage,
    }

    const base = threadRef.current
    const updatedThread: ChatThread = { ...base, messages: [...base.messages, userMsg] }
    threadRef.current = updatedThread
    setThread(updatedThread)
    saveChatThread(paperId, updatedThread)

    // Queue as a pending instruction for the next agent generation call.
    addPendingInstruction(paperId, text)

    setIsStreaming(true)
    setStreamingText('')

    // Narrator messages are UI-only — never send them to the model.
    const apiMessages: ChatRequestMessage[] = updatedThread.messages
      .filter((m) => m.role !== 'narrator')
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))

    try {
      let accumulated = ''
      await streamAgentChat(
        apiMessages,
        context,
        (chunk) => {
          accumulated += chunk
          setStreamingText(accumulated)
        },
        modelConfigRef.current,
      )

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: accumulated,
        timestamp: new Date().toISOString(),
        stage: context.currentStage,
      }
      const latest = threadRef.current
      const finalThread: ChatThread = { ...latest, messages: [...latest.messages, assistantMsg] }
      threadRef.current = finalThread
      setThread(finalThread)
      saveChatThread(paperId, finalThread)
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `⚠️ Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
        stage: context.currentStage,
      }
      const latest = threadRef.current
      const errorThread: ChatThread = { ...latest, messages: [...latest.messages, errorMsg] }
      threadRef.current = errorThread
      setThread(errorThread)
      saveChatThread(paperId, errorThread)
    } finally {
      setIsStreaming(false)
      setStreamingText('')
    }
  }, [input, isStreaming, paperId, context])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  // ─── shared render pieces (only one mode mounts at a time → no duplicate testids) ──

  const statusDot = (
    <span className="relative flex h-2 w-2">
      {isStreaming && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${isStreaming ? 'bg-blue-500' : 'bg-green-500'}`}
      />
    </span>
  )

  const renderNarrator = (msg: ChatMessage) => (
    <div
      key={msg.id}
      data-testid="checkpoint-message"
      data-checkpoint={msg.checkpoint?.checkpointId}
      className="rounded-lg border border-l-2 border-l-primary bg-muted/40 px-3 py-2.5 text-sm space-y-2"
    >
      {msg.checkpoint?.blocking && (
        <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          BLOCKING GATE
        </span>
      )}
      <div className="whitespace-pre-wrap text-foreground">{msg.content}</div>
      {msg.checkpoint && msg.checkpoint.actions.length > 0 && (
        <div
          className="flex flex-wrap gap-2 pt-0.5"
          data-testid={`checkpoint-actions-${msg.checkpoint.checkpointId}`}
        >
          {msg.checkpoint.actions.map((a) => (
            <Button
              key={a.testid}
              size="sm"
              variant={a.variant ?? 'default'}
              data-testid={a.testid}
              onClick={() => router.push(a.href)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )

  const messagesArea = (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      aria-live="polite"
      aria-label="Orchestrator messages"
    >
      {thread.messages.length === 0 && !isStreaming && (
        <p className="text-xs text-muted-foreground text-center py-8">
          The orchestrator will narrate each stage here. Ask anything about your paper — your
          messages also become instructions for the next generation step.
        </p>
      )}

      {thread.messages.map((msg) => {
        if (msg.role === 'narrator') return renderNarrator(msg)
        return (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.content}
            </div>
          </div>
        )
      })}

      {isStreaming && streamingText && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted text-foreground whitespace-pre-wrap">
            {streamingText}
            <span className="inline-block w-0.5 h-3 bg-blue-400 ml-0.5 animate-pulse align-middle" />
          </div>
        </div>
      )}

      {isStreaming && !streamingText && (
        <div className="flex justify-start">
          <div className="rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground italic">
            Thinking…
          </div>
        </div>
      )}
    </div>
  )

  const inputArea = (
    <div className="border-t px-3 py-3">
      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your paper…"
          className="min-h-[40px] max-h-[100px] resize-none text-sm"
          rows={1}
          disabled={isStreaming}
          data-testid="chat-input"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          className="self-end"
          data-testid="chat-send"
        >
          Send
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        Your messages are queued as instructions for the next AI step.
      </p>
    </div>
  )

  // ─── Docked pane (lg+) ─────────────────────────────────────────────────────
  if (mounted && isWide) {
    return (
      <aside data-testid="orchestrator-pane" className="hidden lg:flex lg:w-[22rem] xl:w-96 lg:shrink-0">
        <div
          className="flex w-full flex-col overflow-hidden rounded-xl border bg-background shadow-sm lg:sticky lg:top-6"
          style={{ height: 'calc(100vh - 3rem)' }}
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            {statusDot}
            <span className="text-sm font-semibold">Orchestrator</span>
            {context.currentStage && (
              <span className="truncate text-xs text-muted-foreground">· {context.currentStage}</span>
            )}
          </div>
          {messagesArea}
          {inputArea}
        </div>
      </aside>
    )
  }

  // ─── Floating collapsed button (mobile/tablet) ─────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={togglePanel}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
        aria-label="Open orchestrator chat"
        data-testid="chat-toggle"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    )
  }

  // ─── Floating expanded panel (mobile/tablet) ───────────────────────────────
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex w-80 flex-col rounded-xl border bg-background shadow-2xl sm:w-96"
      style={{ height: 'min(500px, 70vh)' }}
      data-testid="chat-panel"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {statusDot}
          <span className="text-sm font-semibold">Orchestrator</span>
          {context.currentStage && (
            <span className="text-xs text-muted-foreground">· {context.currentStage}</span>
          )}
        </div>
        <button
          onClick={togglePanel}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close orchestrator chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {messagesArea}
      {inputArea}
    </div>
  )
}
