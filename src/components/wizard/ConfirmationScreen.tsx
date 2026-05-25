'use client'

// Confirmation screen — shown after all 11 steps are complete.
// Displays a summary of every parameter before the user triggers generation.

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WizardFormData } from '@/app/intake/page'

interface Props {
  data: WizardFormData
  onEdit: () => void
  onApprove: () => void
}

const TYPE_LABELS: Record<string, string> = {
  imrad:        'IMRaD',
  lit_review:   'Literature Review',
  theoretical:  'Theoretical / Conceptual',
  case_study:   'Case Study',
  policy_brief: 'Policy Brief',
  conference:   'Conference Paper',
}

export function ConfirmationScreen({ data, onEdit, onApprove }: Props) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Topic', value: data.topic || '—' },
    { label: 'Research Question', value: data.researchQuestion || '—' },
    { label: 'Paper Type', value: data.paperType ? TYPE_LABELS[data.paperType] : '—' },
    { label: 'Target Journal', value: data.targetJournal || 'Not specified' },
    { label: 'Citation Format', value: data.citationFormat || '—' },
    { label: 'Output Formats', value: data.outputFormats.length > 0
        ? data.outputFormats.map((f) => <Badge key={f} variant="secondary" className="mr-1">{f}</Badge>)
        : '—'
    },
    { label: 'Language', value: data.language },
    { label: 'Bilingual Abstract', value: data.bilingualAbstract ? 'Yes' : 'No' },
    { label: 'Target Word Count', value: data.wordCount ? `${data.wordCount.toLocaleString()} words` : '—' },
    {
      label: 'Existing Materials',
      value: Object.entries(data.existingMaterials)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ') || 'None',
    },
    {
      label: 'Authors',
      value: data.authors.length > 0
        ? data.authors.map((a) => a.name || 'Unnamed').join(', ')
        : '—',
    },
    { label: 'Style Notes', value: data.styleProfile || 'None (default style)' },
    {
      label: 'Funding',
      value: data.hasFunding
        ? data.fundingSources.filter(Boolean).join(' | ') || 'Specified (no details)'
        : 'No external funding',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Review your paper configuration</h2>
        <p className="text-sm text-muted-foreground">
          Check everything below before generating. Once you approve, the pipeline starts.
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.label}
                className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}
              >
                <td className="px-4 py-2.5 font-medium text-muted-foreground w-40 align-top">
                  {row.label}
                </td>
                <td className="px-4 py-2.5 break-words">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onEdit} type="button">
          ← Edit
        </Button>
        <Button onClick={onApprove} className="flex-1" type="button">
          Approve & Generate Paper →
        </Button>
      </div>
    </div>
  )
}
