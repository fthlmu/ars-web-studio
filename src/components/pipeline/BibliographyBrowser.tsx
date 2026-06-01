'use client'

// BibliographyBrowser — FR-08
// Displays the full verified bibliography in a scrollable table.
// Each row shows evidence/quality/relevance badges, DOI verification status,
// a relevance score, an expand button for the full annotation, and an Exclude
// checkbox. Excluded rows are dimmed. A non-blocking amber warning fires when
// the count of non-excluded sources drops below bibliography.minimumSources.

import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import type { Bibliography, BibSource, QualityTier, Relevance } from '@/lib/types'

// ── prop type (exported so the page can reference it) ──
export interface BibliographyBrowserProps {
  bibliography: Bibliography
  onToggleExclude: (id: string, excluded: boolean) => void
}

// ── helpers: map coded values to human-readable labels ──

// Quality tier labels — tier_x -> readable text for the badge
function qualityTierLabel(tier: QualityTier): string {
  switch (tier) {
    case 'tier_1': return 'Top journal'
    case 'tier_2': return 'Peer-reviewed'
    case 'tier_3': return 'Other academic'
    case 'tier_4': return 'Grey lit'
    default:       return tier
  }
}

// Badge variant per quality tier: tier_1 = default (primary), tier_4 = outline
function qualityTierVariant(tier: QualityTier): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (tier) {
    case 'tier_1': return 'default'
    case 'tier_2': return 'secondary'
    case 'tier_3': return 'outline'
    case 'tier_4': return 'destructive'
    default:       return 'outline'
  }
}

// Relevance badge variant
function relevanceVariant(r: Relevance): 'default' | 'secondary' | 'outline' {
  switch (r) {
    case 'core':        return 'default'
    case 'supporting':  return 'secondary'
    case 'peripheral':  return 'outline'
    default:            return 'outline'
  }
}

// ── row-level sub-component ──
interface RowProps {
  source: BibSource
  onToggleExclude: (id: string, excluded: boolean) => void
}

function BibRow({ source, onToggleExclude }: RowProps) {
  // expanded = show full annotation + DOI + citation below the main cells
  const [expanded, setExpanded] = useState(false)

  const isExcluded = source.excluded === true

  return (
    <>
      {/* Main data row */}
      <TableRow
        className={isExcluded ? 'opacity-40' : undefined}
      >
        {/* ID */}
        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {source.id}
        </TableCell>

        {/* Title + authors + year */}
        <TableCell className="min-w-[14rem] max-w-[22rem]">
          <p className="font-medium leading-snug line-clamp-2">{source.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {source.authors} · {source.year}
          </p>
        </TableCell>

        {/* Evidence tier 1-7 */}
        <TableCell className="whitespace-nowrap">
          <Badge variant="outline">
            Tier {source.evidenceTier}
          </Badge>
        </TableCell>

        {/* Quality tier — readable text label, never icon-only (NFR-17) */}
        <TableCell className="whitespace-nowrap">
          <Badge variant={qualityTierVariant(source.qualityTier)}>
            {qualityTierLabel(source.qualityTier)}
          </Badge>
        </TableCell>

        {/* Relevance */}
        <TableCell className="whitespace-nowrap capitalize">
          <Badge variant={relevanceVariant(source.relevance)}>
            {source.relevance}
          </Badge>
        </TableCell>

        {/* DOI verified — always text label (NFR-17); never icon-only */}
        <TableCell className="whitespace-nowrap">
          {source.verified ? (
            <span className="text-green-600 dark:text-green-400 text-xs font-medium">
              {/* Unicode check mark so there is no hidden icon dependency */}
              ✓ Verified
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">
              — Unverified
            </span>
          )}
        </TableCell>

        {/* Relevance score N/10 */}
        <TableCell className="whitespace-nowrap text-xs">
          {source.relevanceScore}/10
        </TableCell>

        {/* Expand toggle */}
        <TableCell>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse details for ${source.id}` : `Expand details for ${source.id}`}
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded ? 'Hide' : 'Details'}
          </Button>
        </TableCell>

        {/* Exclude checkbox — calls parent callback (FR-08) */}
        <TableCell>
          <Checkbox
            checked={isExcluded}
            aria-label={`Exclude source ${source.id} from bibliography`}
            onCheckedChange={(checked: boolean) =>
              onToggleExclude(source.id, checked)
            }
          />
        </TableCell>
      </TableRow>

      {/* Expandable detail row — annotation, DOI, full citation */}
      {expanded && (
        <TableRow className={isExcluded ? 'opacity-40' : undefined}>
          {/* colspan spans all 9 columns */}
          <TableCell colSpan={9} className="bg-muted/30 text-sm space-y-2 py-3">
            {/* Annotation */}
            <div>
              <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Annotation
              </span>
              <p className="mt-0.5 leading-relaxed">{source.annotation}</p>
            </div>

            {/* DOI */}
            {source.doi && (
              <div>
                <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  DOI
                </span>
                <p className="mt-0.5 font-mono text-xs break-all">{source.doi}</p>
              </div>
            )}

            {/* Full citation */}
            <div>
              <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Citation
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                {source.citation}
              </p>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ── main export ──
export function BibliographyBrowser({
  bibliography,
  onToggleExclude,
}: BibliographyBrowserProps) {
  // Count non-excluded sources for the amber below-minimum warning
  const activeCount = bibliography.sources.filter(s => !s.excluded).length
  const isBelowMinimum = activeCount < bibliography.minimumSources

  return (
    <div className="space-y-3">

      {/* Non-blocking amber warning — shown when active sources < minimumSources */}
      {isBelowMinimum && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          Below the recommended minimum ({activeCount} of {bibliography.minimumSources} sources kept).
          Consider un-excluding some sources or adjusting your search strategy.
        </div>
      )}

      {/* Scrollable table — max height ~28rem so the page doesn't become one huge scroll (FR-08) */}
      <ScrollArea className="max-h-[28rem] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Title / Authors</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Relevance</TableHead>
              <TableHead>DOI Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>{/* expand button */}</TableHead>
              <TableHead>Exclude</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {bibliography.sources.map(source => (
              <BibRow
                key={source.id}
                source={source}
                onToggleExclude={onToggleExclude}
              />
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Coverage summary below the table */}
      <p className="text-xs text-muted-foreground">
        {activeCount} active source{activeCount !== 1 ? 's' : ''} ·{' '}
        {bibliography.sources.filter(s => s.verified && !s.excluded).length} verified ·{' '}
        minimum recommended: {bibliography.minimumSources}
      </p>

      {/* Coverage assessment from the pipeline agent */}
      {bibliography.coverageAssessment && (
        <p className="text-xs text-muted-foreground italic">
          Coverage: {bibliography.coverageAssessment}
        </p>
      )}
    </div>
  )
}
