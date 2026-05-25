'use client'

// Intake wizard — orchestrates all 11 steps and produces a PaperConfig saved to localStorage.
// Think of this like a state machine: currentStep is the state, Next/Back are transitions.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'

import { StepTopic } from '@/components/wizard/StepTopic'
import { StepPaperType } from '@/components/wizard/StepPaperType'
import { StepJournal } from '@/components/wizard/StepJournal'
import { StepCitation } from '@/components/wizard/StepCitation'
import { StepOutputFormat } from '@/components/wizard/StepOutputFormat'
import { StepLanguage } from '@/components/wizard/StepLanguage'
import { StepWordCount } from '@/components/wizard/StepWordCount'
import { StepMaterials } from '@/components/wizard/StepMaterials'
import { StepAuthors } from '@/components/wizard/StepAuthors'
import { StepStyle } from '@/components/wizard/StepStyle'
import { StepFunding } from '@/components/wizard/StepFunding'
import { ConfirmationScreen } from '@/components/wizard/ConfirmationScreen'

import { clearDraftConfig, generatePaperId, loadDraftConfig, savePaper } from '@/lib/storage'
import { PaperConfig, PaperState, Author } from '@/lib/types'

// All form data collected across the 11 steps.
// Exported so ConfirmationScreen can reference this type.
export interface WizardFormData {
  topic: string
  researchQuestion: string
  paperType: PaperConfig['paperType'] | ''
  targetJournal: string
  citationFormat: PaperConfig['citationFormat'] | ''
  outputFormats: string[]
  language: string
  bilingualAbstract: boolean
  wordCount: number
  existingMaterials: Record<string, boolean>
  authors: Author[]
  styleProfile: string
  hasFunding: boolean
  fundingSources: string[]
  conflictsOfInterest: string
  mode: PaperConfig['mode']
}

const INITIAL_FORM: WizardFormData = {
  topic: '',
  researchQuestion: '',
  paperType: '',
  targetJournal: '',
  citationFormat: '',
  outputFormats: ['markdown', 'latex'],
  language: 'English',
  bilingualAbstract: false,
  wordCount: 0,
  existingMaterials: {},
  authors: [{ name: '', affiliation: '', email: '', creditRoles: [], isCorresponding: true }],
  styleProfile: '',
  hasFunding: false,
  fundingSources: [''],
  conflictsOfInterest: 'The authors declare no conflicts of interest.',
  mode: 'full',
}

const TOTAL_STEPS = 11

// Step titles shown in the progress header
const STEP_TITLES = [
  'Topic & Research Question',
  'Paper Type',
  'Target Journal',
  'Citation Format',
  'Output Formats',
  'Language',
  'Word Count',
  'Existing Materials',
  'Authors',
  'Writing Style',
  'Funding & Disclosures',
]


function formFromDraftConfig(config: PaperConfig): WizardFormData {
  return {
    topic: config.topic,
    researchQuestion: config.researchQuestion,
    paperType: config.paperType,
    targetJournal: config.targetJournal ?? '',
    citationFormat: config.citationFormat,
    outputFormats: config.outputFormats.length > 0 ? config.outputFormats : ['markdown', 'latex'],
    language: config.language,
    bilingualAbstract: config.bilingualAbstract,
    wordCount: config.wordCount,
    existingMaterials: config.existingMaterials,
    authors: config.authors.length > 0
      ? config.authors
      : [{ name: '', affiliation: '', email: '', creditRoles: [], isCorresponding: true }],
    styleProfile: config.styleProfile ?? '',
    hasFunding: config.fundingSources.length > 0,
    fundingSources: config.fundingSources.length > 0 ? config.fundingSources : [''],
    conflictsOfInterest: 'The authors declare no conflicts of interest.',
    mode: config.mode,
  }
}

// Convert wizard form data into the PaperConfig contract that the pipeline expects
function buildPaperConfig(data: WizardFormData): PaperConfig {
  // Build funding sources string array from the wizard entries
  const funding = data.hasFunding
    ? data.fundingSources.filter(Boolean)
    : []

  return {
    topic: data.topic,
    researchQuestion: data.researchQuestion,
    paperType: data.paperType as PaperConfig['paperType'],
    targetJournal: data.targetJournal || undefined,
    citationFormat: data.citationFormat as PaperConfig['citationFormat'],
    outputFormats: data.outputFormats,
    language: data.language,
    bilingualAbstract: data.bilingualAbstract,
    wordCount: data.wordCount,
    existingMaterials: data.existingMaterials,
    authors: data.authors.filter((a) => a.name.trim() !== ''),
    styleProfile: data.styleProfile || undefined,
    fundingSources: funding,
    mode: data.mode,
  }
}

export default function IntakePage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [form, setForm] = useState<WizardFormData>(INITIAL_FORM)

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      const draft = loadDraftConfig()
      if (draft) {
        setForm(formFromDraftConfig(draft))
        clearDraftConfig()
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Generic field updater — works for any top-level field
  const set = <K extends keyof WizardFormData>(field: K, value: WizardFormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((s) => s + 1)
    } else {
      setShowConfirmation(true)
    }
  }

  const handleBack = () => {
    if (showConfirmation) {
      setShowConfirmation(false)
    } else if (currentStep > 1) {
      setCurrentStep((s) => s - 1)
    }
  }

  // Save to localStorage and navigate to pipeline
  const handleApprove = () => {
    const config = buildPaperConfig(form)
    const state: PaperState = {
      id: generatePaperId(),
      config,
      outline: '',
      outlineApproved: false,
      sections: [],
      generationStatus: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    savePaper(state)
    router.push('/pipeline')
  }

  // "Skip" means: clear that step's field and advance to the next step
  const skipStep = () => {
    if (currentStep === 3) set('targetJournal', '')
    if (currentStep === 10) set('styleProfile', '')
    handleNext()
  }

  // Render the active step component
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <StepTopic
            topic={form.topic}
            researchQuestion={form.researchQuestion}
            onChange={(field, value) => set(field, value)}
          />
        )
      case 2:
        return (
          <StepPaperType
            value={form.paperType}
            onChange={(value) => set('paperType', value)}
          />
        )
      case 3:
        return (
          <StepJournal
            value={form.targetJournal}
            onChange={(value) => set('targetJournal', value)}
            onSkip={skipStep}
          />
        )
      case 4:
        return (
          <StepCitation
            value={form.citationFormat}
            paperType={form.paperType}
            onChange={(value) => set('citationFormat', value)}
          />
        )
      case 5:
        return (
          <StepOutputFormat
            value={form.outputFormats}
            onChange={(value) => set('outputFormats', value)}
          />
        )
      case 6:
        return (
          <StepLanguage
            language={form.language}
            bilingualAbstract={form.bilingualAbstract}
            onLanguageChange={(value) => { if (value) set('language', value) }}
            onBilingualChange={(value) => set('bilingualAbstract', value)}
          />
        )
      case 7:
        return (
          <StepWordCount
            value={form.wordCount}
            paperType={form.paperType}
            onChange={(value) => set('wordCount', value)}
          />
        )
      case 8:
        return (
          <StepMaterials
            value={form.existingMaterials}
            onChange={(value) => set('existingMaterials', value)}
          />
        )
      case 9:
        return (
          <StepAuthors
            value={form.authors}
            onChange={(value) => set('authors', value)}
          />
        )
      case 10:
        return (
          <StepStyle
            value={form.styleProfile}
            onChange={(value) => set('styleProfile', value)}
            onSkip={skipStep}
          />
        )
      case 11:
        return (
          <StepFunding
            hasFunding={form.hasFunding}
            fundingSources={form.fundingSources}
            conflictsOfInterest={form.conflictsOfInterest}
            onHasFundingChange={(value) => set('hasFunding', value)}
            onFundingSourcesChange={(value) => set('fundingSources', value)}
            onConflictsChange={(value) => set('conflictsOfInterest', value)}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header — hidden on confirmation screen */}
        {!showConfirmation && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">
                Step {currentStep} of {TOTAL_STEPS}
              </span>
              <span className="text-sm text-muted-foreground">
                {STEP_TITLES[currentStep - 1]}
              </span>
            </div>
            <Progress value={(currentStep / TOTAL_STEPS) * 100} className="h-1.5" />
          </div>
        )}

        {/* Step content */}
        <div className="mb-8">
          {showConfirmation ? (
            <ConfirmationScreen
              data={form}
              onEdit={handleBack}
              onApprove={handleApprove}
            />
          ) : (
            renderStep()
          )}
        </div>

        {/* Navigation — hidden on confirmation screen (it has its own buttons) */}
        {!showConfirmation && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1}
              className="w-24"
              type="button"
            >
              ← Back
            </Button>
            <Button onClick={handleNext} className="flex-1" type="button">
              {currentStep === TOTAL_STEPS ? 'Review →' : 'Next →'}
            </Button>
          </div>
        )}

      </div>
    </div>
  )
}
