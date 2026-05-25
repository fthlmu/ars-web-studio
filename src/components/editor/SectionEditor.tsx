'use client'

// SectionEditor — Tiptap rich text editor for one paper section.
// Handles: markdown→HTML loading, live editing, auto-save, math rendering, regeneration.
//
// Tiptap is ProseMirror-based — think of it like a structured signal buffer where
// every keypress is a transaction applied to an immutable document tree.
// The Mathematics extension intercepts $...$ and $$...$$ and renders them via KaTeX.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mathematics, { migrateMathStrings } from '@tiptap/extension-mathematics'
import { marked } from 'marked'
import 'katex/dist/katex.min.css'

import { Toolbar } from './Toolbar'
import { Button } from '@/components/ui/button'
import { generateSection, getSectionWordCount, stripHtml } from '@/lib/ars-client'
import type { PaperConfig, Section } from '@/lib/types'

interface Props {
  section: Section
  config: PaperConfig
  outline: string
  completedSections: Section[]   // all other sections (for context when regenerating)
  onSave: (sectionId: string, html: string, wordCount: number) => void
}

// ─── Markdown → HTML conversion ───────────────────────────────────────────────

/**
 * Converts Claude's markdown output to HTML for Tiptap.
 * Returns the input unchanged if it already looks like HTML.
 */
function toHtml(content: string): string {
  if (!content) return '<p></p>'
  // If already HTML (starts with a tag), return as-is
  if (content.trimStart().startsWith('<')) return content
  // Otherwise parse as markdown
  const result = marked.parse(content, { async: false })
  return typeof result === 'string' ? result : '<p></p>'
}

/** Count words in a plain string */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// ─── Math insertion dialog ────────────────────────────────────────────────────

function MathDialog({
  onInsert,
  onClose,
}: {
  onInsert: (latex: string, display: boolean) => void
  onClose: () => void
}) {
  const [latex, setLatex] = useState('')
  const [display, setDisplay] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl border shadow-xl p-5 w-full max-w-md space-y-4">
        <h3 className="font-semibold">Insert Math</h3>
        <div className="space-y-2">
          <textarea
            autoFocus
            className="w-full rounded border bg-muted/30 p-2 font-mono text-sm resize-none"
            rows={3}
            placeholder="E = mc^2"
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={display}
              onChange={(e) => setDisplay(e.target.checked)}
            />
            Display math (centered on its own line)
          </label>
          <p className="text-xs text-muted-foreground">
            {display
              ? 'Will insert as $$...$$'
              : 'Will insert as $...$'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            onClick={() => { onInsert(latex, display); onClose() }}
            disabled={!latex.trim()}
            className="flex-1"
          >
            Insert
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main SectionEditor component ────────────────────────────────────────────

export function SectionEditor({
  section,
  config,
  outline,
  completedSections,
  onSave,
}: Props) {
  const [showMathDialog, setShowMathDialog] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [regenStream, setRegenStream] = useState('')
  const [previousContent, setPreviousContent] = useState<string | null>(null)

  // Track current word count for the color indicator
  const [currentWordCount, setCurrentWordCount] = useState(() =>
    wordCount(stripHtml(toHtml(section.content)))
  )

  // Debounce timer ref for auto-save (save 500ms after last keystroke)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Target word count for this section
  const targetWords = getSectionWordCount(
    config.wordCount,
    config.paperType,
    section.heading
  )

  // ─── Tiptap editor instance ─────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [
      StarterKit,
      Mathematics.configure({
        katexOptions: { throwOnError: false },
      }),   // enables $...$ (inline) and $$...$$ (display) math via KaTeX
    ],
    content: toHtml(section.content),
    editorProps: {
      attributes: {
        class: 'prose max-w-none focus:outline-none min-h-[400px] px-6 py-4',
      },
    },
    onCreate: ({ editor }) => {
      migrateMathStrings(editor)
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      const plain = stripHtml(html)
      const wc = wordCount(plain)
      setCurrentWordCount(wc)

      // Debounced auto-save — waits 500ms after last keystroke
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        onSave(section.id, html, wc)
      }, 500)
    },
  })

  // ─── Reload editor content when section changes ─────────────────────────────

  useEffect(() => {
    if (!editor) return
    const html = toHtml(section.content)
    // Only update if content actually changed (avoids cursor jump)
    if (editor.getHTML() !== html) {
      editor.commands.setContent(html, { emitUpdate: false })
      migrateMathStrings(editor)
    }

    queueMicrotask(() => {
      const plain = stripHtml(toHtml(section.content))
      setCurrentWordCount(wordCount(plain))
      setIsRegenerating(false)
      setRegenStream('')
      setPreviousContent(null)
    })
  }, [section.id, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Math insertion ─────────────────────────────────────────────────────────

  const handleInsertMath = useCallback(
    (latex: string, display: boolean) => {
      if (!editor) return
      if (display) {
        editor.chain().focus().insertBlockMath({ latex }).run()
      } else {
        editor.chain().focus().insertInlineMath({ latex }).run()
      }
    },
    [editor]
  )

  // ─── Section regeneration ───────────────────────────────────────────────────

  const handleRegenerate = useCallback(async () => {
    if (!editor || isRegenerating) return

    // Back up current content before overwriting
    setPreviousContent(editor.getHTML())
    setIsRegenerating(true)
    setRegenStream('')
    editor.commands.setContent('<p><em>Regenerating…</em></p>', { emitUpdate: false })

    let accumulated = ''
    try {
      const content = await generateSection(
        config,
        outline,
        completedSections.filter((s) => s.id !== section.id),
        section.heading,
        targetWords,
        (chunk) => {
          accumulated += chunk
          setRegenStream(accumulated)
          // Show streaming markdown in editor (approximate — final render on done)
          editor.commands.setContent(
            `<p><em>Regenerating… ${accumulated.length} chars</em></p>`,
            { emitUpdate: false }
          )
        }
      )
      const html = toHtml(content)
      editor.commands.setContent(html, { emitUpdate: false })
      migrateMathStrings(editor)
      const finalHtml = editor.getHTML()
      const wc = wordCount(stripHtml(finalHtml))
      setCurrentWordCount(wc)
      onSave(section.id, finalHtml, wc)
    } catch (err) {
      // Restore previous content on error
      if (previousContent) {
        editor.commands.setContent(previousContent, { emitUpdate: false })
      }
      alert(`Regeneration failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsRegenerating(false)
      setRegenStream('')
    }
  }, [editor, isRegenerating, config, outline, completedSections, section, targetWords, onSave, previousContent])

  // ─── Word count color indicator ─────────────────────────────────────────────

  const wcPercent = targetWords > 0 ? (currentWordCount / targetWords) * 100 : 100
  const wcColor =
    wcPercent >= 75 && wcPercent <= 125
      ? 'text-green-600 dark:text-green-400'
      : wcPercent >= 50 && wcPercent <= 150
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-red-500'

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background">

      {/* Toolbar */}
      <Toolbar
        editor={editor}
        onInsertMath={() => setShowMathDialog(true)}
        onRegenerate={handleRegenerate}
        isRegenerating={isRegenerating}
      />

      {/* Word count bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-muted/20 text-xs">
        <span className={`font-medium tabular-nums ${wcColor}`}>
          {currentWordCount.toLocaleString()} words
        </span>
        <span className="text-muted-foreground">
          target: ~{targetWords.toLocaleString()}
        </span>
        {isRegenerating && regenStream && (
          <span className="text-muted-foreground">
            streamed {regenStream.length.toLocaleString()} chars
          </span>
        )}
        {wcPercent >= 75 && wcPercent <= 125 && (
          <span className="text-green-600 dark:text-green-400">✓ on target</span>
        )}
        {(wcPercent < 75 || wcPercent > 125) && (
          <span className={wcColor}>
            {wcPercent < 75 ? '▼ too short' : '▲ too long'}
          </span>
        )}

        {/* Restore previous version button */}
        {previousContent && !isRegenerating && (
          <button
            type="button"
            onClick={() => {
              editor?.commands.setContent(previousContent, { emitUpdate: false })
              const wc = wordCount(stripHtml(previousContent))
              setCurrentWordCount(wc)
              onSave(section.id, previousContent, wc)
              setPreviousContent(null)
            }}
            className="ml-auto text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            ↩ Restore previous version
          </button>
        )}
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      {/* Math dialog */}
      {showMathDialog && (
        <MathDialog
          onInsert={handleInsertMath}
          onClose={() => setShowMathDialog(false)}
        />
      )}
    </div>
  )
}
