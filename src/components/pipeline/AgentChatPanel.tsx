'use client'

// AgentChatPanel — collapsible interactive chat panel for talking to the AI agent (P20).
// Rendered inside the pipeline layout so it's available on all /pipeline/* stages.
// Starts collapsed. User toggles it with a floating button.
// Messages are persisted in localStorage and also queued as "pending instructions"
// for the next agent generation call (apply-to-next-section pattern).

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { streamAgentChat, type ChatContext, type ChatRequestMessage } from '@/lib/agent-chat'
import { loadChatThread, saveChatThread, addPendingInstruction } from '@/lib/chat-persistence'
import { loadModelConfig } from '@/lib/storage'
import type { ChatMessage, ChatThread, ModelConfig } from '@/lib/types'

interface Props {
  paperId: string
  context: ChatContext
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function AgentChatPanel({ paperId, context }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [thread, setThread] = useState<ChatThread>({ messages: [], pendingInstructions: [] })
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // Load saved thread + model config on mount
  useEffect(() => {
    modelConfigRef.current = loadModelConfig()

    // Remember panel state
    const panelState = localStorage.getItem('ars_chat_panel_open')

    queueMicrotask(() => {
      const saved = loadChatThread(paperId)
      setThread(saved)
      if (panelState === 'true') setIsOpen(true)
    })
  }, [paperId])

  // Auto-scroll to bottom when messages change or streaming updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [thread.messages, streamingText])

  // Persist panel open/close preference
  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      localStorage.setItem('ars_chat_panel_open', String(next))
      return next
    })
  }, [])

  // Send a message
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')

    // Add user message to thread
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      stage: context.currentStage,
    }

    const updatedThread: ChatThread = {
      ...thread,
      messages: [...thread.messages, userMsg],
    }
    setThread(updatedThread)
    saveChatThread(paperId, updatedThread)

    // Also queue as pending instruction for the next agent call
    addPendingInstruction(paperId, text)

    // Stream the assistant response
    setIsStreaming(true)
    setStreamingText('')

    const apiMessages: ChatRequestMessage[] = updatedThread.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      let accumulated = ''
      await streamAgentChat(
        apiMessages,
        context,
        (chunk) => {
          accumulated += chunk
          setStreamingText(accumulated)
        },
        modelConfigRef.current
      )

      // Add assistant message
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: accumulated,
        timestamp: new Date().toISOString(),
        stage: context.currentStage,
      }

      const finalThread: ChatThread = {
        ...updatedThread,
        messages: [...updatedThread.messages, assistantMsg],
      }
      setThread(finalThread)
      saveChatThread(paperId, finalThread)
    } catch (err) {
      // Add error as assistant message so user sees what went wrong
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `⚠️ Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
        stage: context.currentStage,
      }
      const errorThread: ChatThread = {
        ...updatedThread,
        messages: [...updatedThread.messages, errorMsg],
      }
      setThread(errorThread)
      saveChatThread(paperId, errorThread)
    } finally {
      setIsStreaming(false)
      setStreamingText('')
    }
  }, [input, isStreaming, thread, paperId, context])

  // Handle Enter to send, Shift+Enter for newline
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  // ─── Collapsed state: floating button ──────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={togglePanel}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Open AI chat"
        data-testid="chat-toggle"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    )
  }

  // ─── Expanded state: full chat panel ───────────────────────────────────────
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex w-80 sm:w-96 flex-col rounded-xl border bg-background shadow-2xl"
      style={{ height: 'min(500px, 70vh)' }}
      data-testid="chat-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {isStreaming && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${isStreaming ? 'bg-blue-500' : 'bg-green-500'}`} />
          </span>
          <span className="text-sm font-semibold">AI Assistant</span>
          {context.currentStage && (
            <span className="text-xs text-muted-foreground">· {context.currentStage}</span>
          )}
        </div>
        <button
          onClick={togglePanel}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close AI chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {thread.messages.length === 0 && !isStreaming && (
          <p className="text-xs text-muted-foreground text-center py-8">
            Ask the AI assistant anything about your paper. Your messages will also be used as instructions for the next generation step.
          </p>
        )}

        {thread.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
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
        ))}

        {/* Streaming indicator */}
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

      {/* Input */}
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
    </div>
  )
}
