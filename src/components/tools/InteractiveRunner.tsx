'use client'

// Quick Tools — interactive (multi-turn) runner (QT7).
//
// The three modes #4 research-socratic, #9 paper-plan, #20 review-guided declare
// delivery: 'interactive'. The generic runner would fire them as a single shot, which
// defeats the point — these modes are a dialogue. This component gives them a real chat:
//
//   1. Collect the SEED input (topic for #4/#9, paper for #20) using the SAME input
//      components the generic runner uses (TopicInput / PaperInput).
//   2. Build the FIRST user message with buildUserMessage(mode, inputs) — this prepends
//      the `MODE: <key>` directive exactly like the one-shot path, so the SKILL routes
//      to the right behaviour.
//   3. Render a chat thread. Each send appends the user turn, streams the assistant reply
//      via streamChat(systemPrompt, fullHistory, onChunk), then stores it.
//
// Signal-flow framing: think of it as the same transmitter (streamChat → /api/tools-chat)
// but now in full-duplex — we keep the running transcript and feed the whole thing back
// each turn so the model has context.

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ToolMode } from '@/lib/tools/registry'
import { resolveSystemPrompt, buildUserMessage } from '@/lib/tools/prompt-builder'
import type { ToolInputs } from '@/lib/tools/prompt-builder'
import { streamChat, type ChatMessage } from '@/lib/tools/chat'
import { loadModelConfig } from '@/lib/storage'
import type { ModelConfig } from '@/lib/types'
import { saveImportedPaper, loadImportedPaper } from '@/lib/tools/imported-paper'
import { TopicInput } from '@/components/tools/TopicInput'
import { PaperInput } from '@/components/tools/PaperInput'

interface InteractiveRunnerProps {
  mode: ToolMode
}

export function InteractiveRunner({ mode }: InteractiveRunnerProps) {
  // What seed input this mode needs. Interactive modes declare exactly one of these.
  const seedType = mode.intake[0] // 'topic' (#4/#9) or 'byo-paper' (#20)

  // Resolve the SKILL system prompt once. If the mode is somehow not wired this throws,
  // but the page guards on isApiMode + a wired prompt before rendering this component.
  const systemPromptRef = useRef<string>('')
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)
  useEffect(() => {
    systemPromptRef.current = resolveSystemPrompt(mode)
    modelConfigRef.current = loadModelConfig()
  }, [mode])

  // Seed inputs (collected before the conversation starts).
  const [inputs, setInputs] = useState<ToolInputs>(() => {
    if (typeof window === 'undefined') return {}
    if (seedType === 'byo-paper') {
      const paper = loadImportedPaper()
      return paper !== null ? { paperText: paper } : {}
    }
    return {}
  })

  // Conversation state.
  const [started, setStarted] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')           // the in-progress user input box
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isBusyRef = useRef(false)
  const threadEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the bottom as new content streams in.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // Is the seed input present?
  const seedReady =
    seedType === 'byo-paper'
      ? !!inputs.paperText?.trim()
      : !!inputs.topic?.trim()

  // ── Run one turn: append the user message, stream the assistant reply ────────
  const runTurn = useCallback(
    async (history: ChatMessage[]) => {
      if (isBusyRef.current) return
      isBusyRef.current = true
      setStreaming(true)
      setError(null)

      // Add an empty assistant bubble we stream into.
      setMessages([...history, { role: 'assistant', content: '' }])

      try {
        const full = await streamChat(
          systemPromptRef.current,
          history,
          (chunk) => {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { role: 'assistant', content: last.content + chunk }
              }
              return next
            })
          },
          modelConfigRef.current,
        )
        // Replace the streamed bubble with the final text (defensive — same content).
        setMessages([...history, { role: 'assistant', content: full }])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        // Drop the empty assistant bubble on failure so the user can retry their turn.
        setMessages(history)
      } finally {
        isBusyRef.current = false
        setStreaming(false)
      }
    },
    [],
  )

  // ── Start the conversation: build the first message from the seed input ──────
  function handleStart() {
    if (!seedReady || streaming) return
    if (seedType === 'byo-paper' && inputs.paperText) {
      saveImportedPaper(inputs.paperText)
    }
    const firstMessage = buildUserMessage(mode, inputs)
    const history: ChatMessage[] = [{ role: 'user', content: firstMessage }]
    setStarted(true)
    void runTurn(history)
  }

  // ── Send a follow-up turn ────────────────────────────────────────────────────
  function handleSend() {
    const text = draft.trim()
    if (!text || streaming) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setDraft('')
    void runTurn(history)
  }

  // ── Pre-conversation: collect the seed input ─────────────────────────────────
  if (!started) {
    return (
      <div className="space-y-5">
        {seedType === 'byo-paper' ? (
          <PaperInput
            value={inputs.paperText ?? ''}
            onChange={(text) => {
              saveImportedPaper(text)
              setInputs((prev) => ({ ...prev, paperText: text }))
            }}
            disabled={streaming}
          />
        ) : (
          <TopicInput
            value={inputs.topic ?? ''}
            onChange={(text) => setInputs((prev) => ({ ...prev, topic: text }))}
            disabled={streaming}
          />
        )}

        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          This is an interactive mode — it runs a back-and-forth conversation. A cloud
          model is recommended; local models may follow the long SKILL prompt poorly.
        </div>

        <Button onClick={handleStart} disabled={!seedReady} className="w-full sm:w-auto">
          Start conversation →
        </Button>
      </div>
    )
  }

  // ── The chat thread ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m, i) => (
            <ChatBubble
              key={i}
              role={m.role}
              content={m.content}
              streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
            />
          ))}
          <div ref={threadEndRef} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 space-y-2">
          <p className="text-sm font-medium text-destructive">Failed</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      )}

      {/* Composer */}
      <div className="space-y-2">
        <Label htmlFor="chat-input" className="text-sm font-medium">
          Your reply
        </Label>
        <Textarea
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Type your reply… (Enter to send, Shift+Enter for a new line)"
          rows={3}
          className="resize-none"
          disabled={streaming}
        />
        <Button onClick={handleSend} disabled={streaming || !draft.trim()} className="w-full sm:w-auto">
          {streaming ? 'Generating…' : 'Send →'}
        </Button>
      </div>
    </div>
  )
}

// One message bubble. User turns right-aligned; assistant turns left-aligned.
function ChatBubble({
  role,
  content,
  streaming,
}: {
  role: 'user' | 'assistant'
  content: string
  streaming: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-lg bg-primary/10 px-3.5 py-2.5'
            : 'max-w-[85%] rounded-lg bg-background border px-3.5 py-2.5'
        }
      >
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          {isUser ? 'You' : 'Assistant'}
        </p>
        <div className="text-sm text-foreground/90 leading-relaxed prose prose-sm max-w-none">
          {content || (streaming ? <span className="text-muted-foreground italic">Starting…</span> : null)}
          {streaming && (
            <span className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
          )}
        </div>
      </div>
    </div>
  )
}
