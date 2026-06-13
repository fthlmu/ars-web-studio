'use client'

// OutlineAccordion — collapsible ## sections with inline click-to-edit.
// Default view: rendered markdown (easy to read). Click any section body to edit it
// inline; click away or press Ctrl+Enter to return to read mode.
// A "Edit all (raw)" fallback opens the full document as one textarea.

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'

interface OutlineSection {
  heading: string
  body: string
}

interface ParsedOutline {
  preamble: string
  sections: OutlineSection[]
}

// ─── Parser / serializer ──────────────────────────────────────────────────────

function parseOutline(text: string): ParsedOutline {
  const lines = text.split('\n')
  const sections: OutlineSection[] = []
  let preamble = ''
  let currentHeading: string | null = null
  const currentBody: string[] = []

  for (const line of lines) {
    if (line.match(/^## /)) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentBody.join('\n').trimEnd() })
        currentBody.length = 0
      } else {
        preamble = currentBody.join('\n').trimEnd()
        currentBody.length = 0
      }
      currentHeading = line.slice(3).trim()
    } else {
      currentBody.push(line)
    }
  }

  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentBody.join('\n').trimEnd() })
  } else if (currentBody.length > 0) {
    preamble = currentBody.join('\n').trimEnd()
  }

  return { preamble, sections }
}

function reconstructOutline(preamble: string, sections: OutlineSection[]): string {
  const parts: string[] = []
  if (preamble.trim()) parts.push(preamble.trim())
  for (const sec of sections) {
    parts.push(`## ${sec.heading}`)
    if (sec.body.trim()) parts.push(sec.body)
  }
  return parts.join('\n\n')
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
// Handles: ### headings, #### headings, **bold**, - / * bullet lists, paragraphs.
// No external package needed for these outline patterns.

function renderInline(text: string, key: number): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return (
    <span key={key}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </span>
  )
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  const listItems: string[] = []
  const paraLines: string[] = []
  let k = 0

  function flushPara() {
    if (paraLines.length === 0) return
    const joined = paraLines.join(' ').trim()
    if (joined) nodes.push(<p key={k++} className="text-sm leading-relaxed text-foreground/80 mb-1">{renderInline(joined, k)}</p>)
    paraLines.length = 0
  }

  function flushList() {
    if (listItems.length === 0) return
    nodes.push(
      <ul key={k++} className="list-disc ml-4 space-y-0.5 mb-2">
        {listItems.map((item, i) => (
          <li key={i} className="text-sm text-foreground/80">{renderInline(item, i)}</li>
        ))}
      </ul>
    )
    listItems.length = 0
  }

  for (const line of lines) {
    if (line.startsWith('### ')) {
      flushPara(); flushList()
      nodes.push(<h3 key={k++} className="font-semibold text-sm mt-3 mb-1 text-foreground">{renderInline(line.slice(4).trim(), k)}</h3>)
    } else if (line.startsWith('#### ')) {
      flushPara(); flushList()
      nodes.push(<h4 key={k++} className="font-medium text-sm mt-2 mb-0.5 text-muted-foreground">{renderInline(line.slice(5).trim(), k)}</h4>)
    } else if (line.match(/^[-*] /)) {
      flushPara()
      listItems.push(line.slice(2))
    } else if (line.trim() === '') {
      flushPara(); flushList()
    } else {
      flushList()
      paraLines.push(line)
    }
  }
  flushPara(); flushList()

  return <>{nodes}</>
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  outline: string
  onChange: (newOutline: string) => void
  readOnly?: boolean
}

export function OutlineAccordion({ outline, onChange, readOnly = false }: Props) {
  const [showRawAll, setShowRawAll] = useState(false)

  const parsed = parseOutline(outline)
  const [openSections, setOpenSections] = useState<Set<number>>(
    () => new Set(parsed.sections.map((_, i) => i))
  )
  const [preamble, setPreamble] = useState(parsed.preamble)
  const [sections, setSections] = useState<OutlineSection[]>(parsed.sections)

  // Which item is being edited: -1 = preamble, null = none, >=0 = section index
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const emitChange = useCallback(
    (newPreamble: string, newSections: OutlineSection[]) => {
      onChange(reconstructOutline(newPreamble, newSections))
    },
    [onChange]
  )

  function toggleSection(index: number) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function updateSectionBody(index: number, newBody: string) {
    const updated = sections.map((s, i) => (i === index ? { ...s, body: newBody } : s))
    setSections(updated)
    emitChange(preamble, updated)
  }

  function updatePreamble(newPreamble: string) {
    setPreamble(newPreamble)
    emitChange(newPreamble, sections)
  }

  function handleRawAllChange(newText: string) {
    onChange(newText)
    const re = parseOutline(newText)
    setPreamble(re.preamble)
    setSections(re.sections)
    setOpenSections(new Set(re.sections.map((_, i) => i)))
  }

  function commitEditing() {
    setEditingIndex(null)
  }

  function handleBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      commitEditing()
    }
    if (e.key === 'Escape') {
      commitEditing()
    }
  }

  // Fallback: no sections parsed
  if (sections.length === 0) {
    return (
      <Textarea
        value={outline}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder="Outline will appear here…"
        rows={16}
        className="font-mono text-sm resize-none"
        aria-live="polite"
        aria-label="Paper outline"
      />
    )
  }

  if (showRawAll) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowRawAll(false)}
          >
            ← Back to structured view
          </Button>
        </div>
        <Textarea
          value={outline}
          onChange={(e) => handleRawAllChange(e.target.value)}
          readOnly={readOnly}
          placeholder="Outline text…"
          rows={24}
          className="font-mono text-sm resize-none"
          aria-label="Paper outline (raw)"
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setOpenSections(new Set(sections.map((_, i) => i)))}
          >
            Expand all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setOpenSections(new Set())}
          >
            Collapse all
          </Button>
        </div>
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setShowRawAll(true)}
          >
            📄 Edit all (raw)
          </Button>
        )}
      </div>

      {/* Preamble */}
      {preamble.trim() && (
        <div
          className="rounded-md border bg-muted/20 px-4 py-3 cursor-text relative group"
          onClick={() => { if (!readOnly) setEditingIndex(-1) }}
        >
          {editingIndex === -1 ? (
            <Textarea
              autoFocus
              value={preamble}
              onChange={(e) => updatePreamble(e.target.value)}
              onBlur={commitEditing}
              onKeyDown={handleBodyKeyDown}
              rows={Math.max(3, preamble.split('\n').length + 1)}
              className="font-mono text-xs resize-none border-blue-300 focus-visible:ring-blue-500/30 bg-transparent"
              aria-label="Outline preamble"
            />
          ) : (
            <div className="text-sm text-muted-foreground leading-relaxed">
              {renderMarkdown(preamble)}
              {!readOnly && (
                <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground flex items-center gap-1">
                  <Pencil size={10} /> click to edit
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Section accordion items */}
      {sections.map((section, index) => {
        const isOpen = openSections.has(index)
        const isEditing = editingIndex === index
        const wordCount = countWords(section.body)

        return (
          <div key={index} className="rounded-md border overflow-hidden">
            {/* Clickable header */}
            <button
              type="button"
              onClick={() => toggleSection(index)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
              aria-expanded={isOpen}
            >
              <span className="text-muted-foreground shrink-0">
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <span className="flex-1 text-sm font-semibold">{section.heading}</span>
              {wordCount > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {wordCount} words
                </span>
              )}
            </button>

            {/* Collapsible body */}
            {isOpen && (
              <div
                className="px-4 py-3 bg-background relative group cursor-text"
                onClick={() => { if (!readOnly && !isEditing) setEditingIndex(index) }}
              >
                {isEditing ? (
                  <Textarea
                    autoFocus
                    value={section.body}
                    onChange={(e) => updateSectionBody(index, e.target.value)}
                    onBlur={commitEditing}
                    onKeyDown={handleBodyKeyDown}
                    rows={Math.max(4, section.body.split('\n').length + 1)}
                    className="font-mono text-xs resize-none border-blue-300 focus-visible:ring-blue-500/30 w-full"
                    placeholder="Section content…"
                    aria-label={`Section body: ${section.heading}`}
                  />
                ) : (
                  <div className="min-h-[2rem]">
                    {section.body.trim()
                      ? renderMarkdown(section.body)
                      : <p className="text-sm italic text-muted-foreground">No content yet.</p>
                    }
                    {!readOnly && (
                      <span className="absolute top-2 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground flex items-center gap-1 bg-background/80 px-1.5 py-0.5 rounded">
                        <Pencil size={10} /> click to edit
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
