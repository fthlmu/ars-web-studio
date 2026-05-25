'use client'

// Step 6: Language & Bilingual Abstract
// Choose the paper language and whether to generate a second-language abstract.

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  language: string
  bilingualAbstract: boolean
  onLanguageChange: (value: string | null) => void
  onBilingualChange: (value: boolean) => void
}

const LANGUAGES = [
  'English',
  'Korean (한국어)',
  'Chinese Simplified (简体中文)',
  'Chinese Traditional (繁體中文)',
  'Japanese (日本語)',
  'Spanish (Español)',
  'French (Français)',
  'German (Deutsch)',
  'Arabic (العربية)',
  'Portuguese (Português)',
]

export function StepLanguage({
  language,
  bilingualAbstract,
  onLanguageChange,
  onBilingualChange,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Language</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The language the paper will be written in. English is standard for most
          international journals.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Paper Language</Label>
        <Select value={language} onValueChange={onLanguageChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <Label htmlFor="bilingual" className="font-medium">
            Bilingual Abstract
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generate the abstract in both the paper language and a second language.
            Required by some Korean and Chinese journals.
          </p>
        </div>
        <Switch
          id="bilingual"
          checked={bilingualAbstract}
          onCheckedChange={onBilingualChange}
        />
      </div>

      {bilingualAbstract && (
        <p className="text-sm text-muted-foreground">
          The abstract will be generated in <strong>{language}</strong> and English
          (or Korean if English is selected as the main language).
        </p>
      )}
    </div>
  )
}
