'use client'

// OutlineAccordion — collapsible ## sections with WYSIWYG in-place editing.
// FP-3: raw Textarea edit mode replaced by RichContentBlock — clicking a section body
// mounts an inline Tiptap editor with the same prose typography; raw markdown is never
// exposed to the user. The "Edit all (raw)" textarea mode is removed.

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { RichContentBlock } from '@/components/editor/RichContentBlock'

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

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  outline: string
  onChange: (newOutline: string) => void
  readOnly?: boolean
}

export function OutlineAccordion({ outline, onChange, readOnly = false }: Props) {
  const parsed = parseOutline(outline)
  const [openSections, setOpenSections] = useState<Set<number>>(
    () => new Set(parsed.sections.map((_, i) => i))
  )
  const [preamble, setPreamble] = useState(parsed.preamble)
  const [sections, setSections] = useState<OutlineSection[]>(parsed.sections)

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

  // Fallback: no sections parsed — still show rendered outline (read-only prose)
  if (sections.length === 0) {
    return (
      <RichContentBlock
        content={outline}
        onChange={readOnly ? undefined : onChange}
        contentFormat="markdown"
        placeholder="Outline will appear here…"
        editorClassName="prose max-w-none focus:outline-none min-h-[16rem] px-4 py-3"
        testId="outline-fallback"
      />
    )
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
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

      {/* Preamble */}
      {preamble.trim() && (
        <div className="rounded-md border bg-muted/20 px-4 py-3">
          <RichContentBlock
            content={preamble}
            onChange={readOnly ? undefined : updatePreamble}
            contentFormat="markdown"
            placeholder="Preamble…"
            editorClassName="prose prose-sm max-w-none focus:outline-none min-h-[3rem] py-1"
            testId="outline-preamble"
          />
        </div>
      )}

      {/* Section accordion items */}
      {sections.map((section, index) => {
        const isOpen = openSections.has(index)
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

            {/* Collapsible body — WYSIWYG rendered prose, never raw markdown */}
            {isOpen && (
              <div
                className="px-4 py-3 bg-background"
                data-testid={`outline-section-${index}`}
              >
                <RichContentBlock
                  content={section.body}
                  onChange={readOnly ? undefined : (v) => updateSectionBody(index, v)}
                  contentFormat="markdown"
                  placeholder="No content yet."
                  editorClassName="prose prose-sm max-w-none focus:outline-none min-h-[3rem] py-1"
                  testId={`outline-body-${index}`}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
