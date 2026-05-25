'use client'

// Step 9: Authors
// Add one or more authors with affiliation, email, and CRediT contribution roles.

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Author } from '@/lib/types'

interface Props {
  value: Author[]
  onChange: (value: Author[]) => void
}

// CRediT taxonomy — standard 14 roles for academic contribution statements
const CREDIT_ROLES = [
  'Conceptualization',
  'Data curation',
  'Formal analysis',
  'Funding acquisition',
  'Investigation',
  'Methodology',
  'Project administration',
  'Resources',
  'Software',
  'Supervision',
  'Validation',
  'Visualization',
  'Writing – original draft',
  'Writing – review & editing',
]

function emptyAuthor(): Author {
  return {
    name: '',
    affiliation: '',
    email: '',
    creditRoles: [],
    isCorresponding: false,
  }
}

export function StepAuthors({ value, onChange }: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number>(0)

  const addAuthor = () => {
    const updated = [...value, emptyAuthor()]
    onChange(updated)
    setExpandedIndex(updated.length - 1)
  }

  const removeAuthor = (index: number) => {
    const updated = value.filter((_, i) => i !== index)
    onChange(updated)
    setExpandedIndex(Math.min(expandedIndex, updated.length - 1))
  }

  const updateAuthor = (index: number, field: keyof Author, val: unknown) => {
    const updated = value.map((a, i) => (i === index ? { ...a, [field]: val } : a))
    onChange(updated)
  }

  const toggleRole = (index: number, role: string) => {
    const author = value[index]
    const roles = author.creditRoles.includes(role)
      ? author.creditRoles.filter((r) => r !== role)
      : [...author.creditRoles, role]
    updateAuthor(index, 'creditRoles', roles)
  }

  // Only one author can be the corresponding author
  const setCorresponding = (index: number) => {
    const updated = value.map((a, i) => ({ ...a, isCorresponding: i === index }))
    onChange(updated)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Authors</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Add all authors. CRediT roles document who contributed what — required by
          many journals and helps with transparency.
        </p>
      </div>

      <div className="space-y-3">
        {value.map((author, index) => (
          <div key={index} className="rounded-lg border overflow-hidden">
            {/* Author header — click to expand/collapse */}
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 hover:bg-accent/30 text-left"
              onClick={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {author.name || `Author ${index + 1}`}
                </span>
                {author.isCorresponding && (
                  <Badge variant="outline" className="text-xs">Corresponding</Badge>
                )}
              </div>
              <span className="text-muted-foreground text-sm">
                {expandedIndex === index ? '▲' : '▼'}
              </span>
            </button>

            {/* Expanded author form */}
            {expandedIndex === index && (
              <div className="p-4 border-t space-y-4 bg-background">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Full Name</Label>
                    <Input
                      placeholder="e.g. Fathul Muin"
                      value={author.name}
                      onChange={(e) => updateAuthor(index, 'name', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Affiliation</Label>
                    <Input
                      placeholder="e.g. KAIST, School of Electrical Engineering"
                      value={author.affiliation}
                      onChange={(e) => updateAuthor(index, 'affiliation', e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Email (optional)</Label>
                  <Input
                    type="email"
                    placeholder="e.g. fathul@kaist.ac.kr"
                    value={author.email ?? ''}
                    onChange={(e) => updateAuthor(index, 'email', e.target.value)}
                  />
                </div>

                {/* CRediT roles */}
                <div className="space-y-2">
                  <Label className="text-sm">CRediT Contribution Roles</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CREDIT_ROLES.map((role) => (
                      <div
                        key={role}
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => toggleRole(index, role)}
                      >
                        <Checkbox
                          checked={author.creditRoles.includes(role)}
                          onCheckedChange={() => toggleRole(index, role)}
                          id={`${index}-${role}`}
                        />
                        <Label
                          htmlFor={`${index}-${role}`}
                          className="text-xs cursor-pointer leading-tight"
                        >
                          {role}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Corresponding author + remove */}
                <div className="flex items-center justify-between pt-2">
                  <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setCorresponding(index)}
                  >
                    <Checkbox
                      checked={author.isCorresponding}
                      onCheckedChange={() => setCorresponding(index)}
                      id={`corresponding-${index}`}
                    />
                    <Label htmlFor={`corresponding-${index}`} className="text-sm cursor-pointer">
                      Corresponding author
                    </Label>
                  </div>
                  {value.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAuthor(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Button variant="outline" onClick={addAuthor} type="button" className="w-full">
        + Add Author
      </Button>
    </div>
  )
}
