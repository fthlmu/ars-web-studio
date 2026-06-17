'use client'

// RichContentBlock — shared WYSIWYG block: read mode renders markdown/HTML as prose;
// clicking (when editable) mounts an inline Tiptap editor with the same typography.
// Save on Ctrl/Cmd+Enter or Save button; Esc-to-cancel; save-on-blur when focus leaves.
//
// One conversion path used by every paper surface:
//   markdown → HTML:  toHtml()  (via marked)
//   HTML → markdown:  htmlToMarkdown()  (simple DOM serializer for outline subset)

import { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mathematics, { migrateMathStrings } from '@tiptap/extension-mathematics'
import { marked } from 'marked'
import 'katex/dist/katex.min.css'
import { MaterialGapHighlight } from '@/lib/editor/material-gap-mark'

// ─── Conversion utilities (exported for reuse) ────────────────────────────────

/** markdown or HTML → HTML for rendering and Tiptap seeding */
export function toHtml(content: string): string {
  if (!content) return '<p></p>'
  if (content.trimStart().startsWith('<')) return content
  const result = marked.parse(content, { async: false })
  return typeof result === 'string' ? result : '<p></p>'
}

/** Serialize a DOM node to the markdown subset used in outlines */
function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const inner = Array.from(el.childNodes).map(serializeNode).join('')
  switch (tag) {
    case 'h1':   return `# ${inner}\n\n`
    case 'h2':   return `## ${inner}\n\n`
    case 'h3':   return `### ${inner}\n\n`
    case 'h4':   return `#### ${inner}\n\n`
    case 'p':    return inner.trim() ? `${inner}\n\n` : ''
    case 'strong': case 'b': return `**${inner}**`
    case 'em':   case 'i':   return `_${inner}_`
    case 'code': return `\`${inner}\``
    case 'br':   return '\n'
    case 'ul': {
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li')
      return items.map((li) => `- ${serializeNode(li).trim()}`).join('\n') + '\n\n'
    }
    case 'ol': {
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li')
      return items.map((li, idx) => `${idx + 1}. ${serializeNode(li).trim()}`).join('\n') + '\n\n'
    }
    case 'li':        return inner
    case 'blockquote': return `> ${inner}\n\n`
    case 'body':      return inner
    default:          return inner
  }
}

/** HTML → markdown (browser-only; handles the outline-section subset) */
export function htmlToMarkdown(html: string): string {
  if (typeof window === 'undefined') return html
  if (!html || html === '<p></p>' || html === '<p><br></p>') return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  return serializeNode(doc.body).replace(/\n{3,}/g, '\n\n').trim()
}

// ─── Inner edit component (mounts Tiptap only while editing) ─────────────────

interface EditProps {
  html: string
  onCommit: (html: string) => void
  onCancel: () => void
  editorClass: string
}

function InlineEditor({ html, onCommit, onCancel, editorClass }: EditProps) {
  const committedRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Mathematics.configure({ katexOptions: { throwOnError: false } }),
      MaterialGapHighlight,
    ],
    content: html,
    editorProps: {
      attributes: { class: editorClass },
    },
    onCreate: ({ editor }) => {
      migrateMathStrings(editor)
      queueMicrotask(() => editor.commands.focus('end'))
    },
  })

  const commit = useCallback(() => {
    if (!editor || committedRef.current) return
    committedRef.current = true
    onCommit(editor.getHTML())
  }, [editor, onCommit])

  const cancel = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    onCancel()
  }, [onCancel])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit() }
  }

  function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Commit only when focus leaves the entire container (not just the editor → button)
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      commit()
    }
  }

  return (
    <div
      // tabIndex so this div can receive focus for the blur check
      tabIndex={-1}
      className="rounded border border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/30 outline-none"
      onBlur={handleContainerBlur}
      onKeyDown={handleKeyDown}
    >
      <EditorContent editor={editor} />
      <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-2 py-1 text-xs">
        <button
          type="button"
          // mouseDown prevents blur firing before click
          onMouseDown={(e) => { e.preventDefault(); cancel() }}
          className="rounded px-2 py-0.5 text-muted-foreground hover:text-foreground"
        >
          Esc cancel
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); commit() }}
          className="rounded bg-primary px-2 py-0.5 text-primary-foreground hover:bg-primary/90"
        >
          Save
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  /** markdown or HTML content to display / edit */
  content: string
  /** When provided and readOnly=false, clicking enables editing */
  onChange?: (newContent: string) => void
  readOnly?: boolean
  /**
   * 'markdown' → save converts Tiptap HTML back to markdown via htmlToMarkdown.
   * 'html'     → save passes raw Tiptap HTML (default — matches Section.content format).
   */
  contentFormat?: 'markdown' | 'html'
  className?: string
  placeholder?: string
  /** Tailwind classes passed to the Tiptap editor's ProseMirror div */
  editorClassName?: string
  /** data-testid applied to the root element */
  testId?: string
}

export function RichContentBlock({
  content,
  onChange,
  readOnly = false,
  contentFormat = 'html',
  className = '',
  placeholder = 'No content yet.',
  editorClassName = 'prose max-w-none focus:outline-none min-h-[3rem] px-3 py-2',
  testId,
}: Props) {
  const isEditable = !readOnly && !!onChange
  const [editing, setEditing] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Tiptap is browser-only — defer until after hydration
  useEffect(() => { queueMicrotask(() => setMounted(true)) }, [])

  const readHtml = toHtml(content)

  function handleClick() {
    if (isEditable && !editing && mounted) setEditing(true)
  }

  const handleCommit = useCallback((html: string) => {
    if (!onChange) return
    const out = contentFormat === 'markdown' ? htmlToMarkdown(html) : html
    onChange(out)
    setEditing(false)
  }, [onChange, contentFormat])

  const handleCancel = useCallback(() => {
    setEditing(false)
  }, [])

  return (
    <div
      className={`relative group ${isEditable && !editing ? 'cursor-text' : ''} ${className}`}
      data-testid={testId}
      onClick={handleClick}
    >
      {editing && mounted ? (
        <InlineEditor
          html={readHtml}
          onCommit={handleCommit}
          onCancel={handleCancel}
          editorClass={editorClassName}
        />
      ) : (
        <>
          {readHtml && readHtml !== '<p></p>' ? (
            <div
              className="prose max-w-none"
              dangerouslySetInnerHTML={{ __html: readHtml }}
            />
          ) : (
            <p className="text-sm italic text-muted-foreground">{placeholder}</p>
          )}
          {isEditable && (
            <span
              aria-hidden
              className="pointer-events-none absolute right-2 top-1 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            >
              ✏ click to edit
            </span>
          )}
        </>
      )}
    </div>
  )
}
