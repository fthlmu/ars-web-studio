'use client'

// Toolbar — formatting buttons above the Tiptap editor.
// Receives the editor instance and calls commands on it directly.
// Think of this like a signal processing control panel — each button sends a command
// to the editor's internal state machine (ProseMirror).

import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface Props {
  editor: Editor | null
  onInsertMath: () => void       // opens the math input dialog
  onRegenerate: () => void       // triggers section regeneration
  isRegenerating: boolean
}

// A single toolbar button
function ToolBtn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`h-7 min-w-7 px-1.5 rounded text-sm font-medium transition-colors
        ${active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
    >
      {children}
    </button>
  )
}

export function Toolbar({ editor, onInsertMath, onRegenerate, isRegenerating }: Props) {
  if (!editor) return null

  return (
    <div className="flex items-center gap-0.5 flex-wrap border-b px-2 py-1.5 bg-muted/30">

      {/* Heading levels */}
      <ToolBtn
        title="Heading 1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
      >
        H1
      </ToolBtn>
      <ToolBtn
        title="Heading 2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
      >
        H2
      </ToolBtn>
      <ToolBtn
        title="Heading 3"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
      >
        H3
      </ToolBtn>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Inline formatting */}
      <ToolBtn
        title="Bold (Ctrl+B)"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
      >
        <strong>B</strong>
      </ToolBtn>
      <ToolBtn
        title="Italic (Ctrl+I)"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
      >
        <em>I</em>
      </ToolBtn>
      <ToolBtn
        title="Code"
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')}
      >
        {'<>'}
      </ToolBtn>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Lists */}
      <ToolBtn
        title="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
      >
        • List
      </ToolBtn>
      <ToolBtn
        title="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
      >
        1. List
      </ToolBtn>
      <ToolBtn
        title="Block quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
      >
        ❝
      </ToolBtn>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Math */}
      <ToolBtn
        title="Insert inline math ($...$) or display math ($$...$$)"
        onClick={onInsertMath}
      >
        ∑ Math
      </ToolBtn>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Regenerate */}
      <Button
        size="sm"
        variant="outline"
        onClick={onRegenerate}
        disabled={isRegenerating}
        className="h-7 text-xs"
      >
        {isRegenerating ? 'Regenerating…' : '↺ Regenerate'}
      </Button>
    </div>
  )
}
