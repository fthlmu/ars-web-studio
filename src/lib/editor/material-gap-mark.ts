// material-gap-mark.ts — render-only highlight for [MATERIAL GAP ...] tags (FR-13/FR-14).
//
// ─── Why a DECORATION and not a MARK (read this first) ───────────────────────────
//
// In Tiptap/ProseMirror there are two ways to "style" text:
//
//   1. A MARK (like bold or a highlight) is STORED IN THE DOCUMENT. It becomes part
//      of the saved content. Problem: when the user saves/edits/regenerates, a mark
//      can be stripped, copied, or accidentally removed — and then the warning is
//      gone even though the literal text "[MATERIAL GAP ...]" is still there.
//
//   2. A DECORATION is a RENDER-ONLY OVERLAY. It is computed on every redraw from the
//      current document text and painted on top. It is NEVER part of the saved
//      document, so it CANNOT be stripped on save. As long as the literal text
//      "[MATERIAL GAP ...]" exists, the yellow highlight + tooltip reappear.
//
// EE analogy: a MARK is like burning a label into the PCB silkscreen (permanent, but
// it travels with the board and can be scratched off). A DECORATION is like a heads-up
// projector overlay that re-draws the label every frame from the live signal — you
// can't accidentally delete it, because it isn't stored anywhere; it's recomputed.
//
// FR-13/FR-14 require that the gap warning can never be silently lost on save. A
// decoration is the only correct choice: it reads the document, paints the overlay,
// and writes nothing back. Save logic is untouched.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

// ─── The canonical [MATERIAL GAP ...] matcher ───────────────────────────────────
//
// IDENTICAL to the regex in src/lib/schemas/schema4.ts and SectionReviewGate.tsx.
// Keep all three byte-for-byte the same so the highlight the user SEES matches the
// count the gate REASONS about. Breakdown:
//   \[MATERIAL GAP   → the literal text "[MATERIAL GAP"
//   [^\]]*           → any run of non-"]" chars (an optional note, e.g. ": no data")
//   \]               → the closing literal "]"
//   /g               → global, so we find every occurrence in a text node
const MATERIAL_GAP_REGEX = /\[MATERIAL GAP[^\]]*\]/g

// The tooltip shown on hover. One clear instruction, no jargon.
const GAP_TITLE =
  'No source material covers this claim — provide the data/source or delete the claim'

// Tailwind classes for the yellow highlight. `rounded-sm px-0.5` gives a small pill
// look; the dark-mode variant keeps it readable on a dark editor background.
const GAP_CLASS =
  'bg-yellow-200 dark:bg-yellow-700/60 rounded-sm px-0.5 cursor-help'

// Unique key so ProseMirror can identify this plugin in the editor's plugin list.
const materialGapPluginKey = new PluginKey('materialGapHighlight')

/**
 * Scan the whole document for [MATERIAL GAP ...] tags and return a DecorationSet
 * of inline decorations — one per match. This runs on every redraw (cheap: it only
 * walks text nodes), so the overlay always reflects the live document text.
 */
function buildGapDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []

  // descendants() walks every node in the document tree. `pos` is the absolute
  // position of the node's start in the document — we add the match offset to it
  // to get the precise [from, to] range for each tag.
  doc.descendants((node, pos) => {
    // We only care about leaf text nodes; skip everything else.
    if (!node.isText || !node.text) return

    const text = node.text

    // Reset lastIndex each time: a /g regex is stateful across .exec() calls, and
    // we reuse the module-level instance, so we must rewind before scanning a node.
    MATERIAL_GAP_REGEX.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = MATERIAL_GAP_REGEX.exec(text)) !== null) {
      // ProseMirror position math: `pos` is where this text node begins, so the
      // match's document range is [pos + matchStart, pos + matchEnd].
      const from = pos + match.index
      const to = from + match[0].length

      decorations.push(
        Decoration.inline(from, to, {
          class: GAP_CLASS,
          title: GAP_TITLE,
        })
      )

      // Guard against a zero-length match causing an infinite loop (defensive — our
      // regex always matches at least "[MATERIAL GAP]", but cheap insurance).
      if (match.index === MATERIAL_GAP_REGEX.lastIndex) {
        MATERIAL_GAP_REGEX.lastIndex++
      }
    }
  })

  return DecorationSet.create(doc, decorations)
}

/**
 * MaterialGapHighlight — a Tiptap Extension (not a Node or Mark) that registers a
 * single ProseMirror plugin. The plugin's `props.decorations` recomputes the yellow
 * overlay from the current document on every render. It NEVER dispatches a
 * transaction and NEVER edits the document, so save logic is completely unaffected
 * and the [MATERIAL GAP ...] text can never be stripped by this extension.
 */
export const MaterialGapHighlight = Extension.create({
  name: 'materialGapHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: materialGapPluginKey,
        props: {
          // Called by ProseMirror on every redraw with the current editor state.
          // We return a fresh DecorationSet computed from the live document text.
          decorations(state) {
            return buildGapDecorations(state.doc)
          },
        },
      }),
    ]
  },
})

export default MaterialGapHighlight
