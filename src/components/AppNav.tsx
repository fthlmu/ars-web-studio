'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const STEPS = [
  { href: '/intake', label: 'Intake' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/editor', label: 'Editor' },
  { href: '/export', label: 'Export' },
]

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur print:hidden">
      <div className="mx-auto flex min-h-14 max-w-6xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          ARS Web Studio
        </Link>

        <nav aria-label="Paper workflow" className="flex items-center gap-1 overflow-x-auto text-xs">
          {STEPS.map((step, index) => {
            const active = isActive(pathname, step.href)
            return (
              <div key={step.href} className="flex items-center gap-1 shrink-0">
                {index > 0 && <span className="text-muted-foreground/60">→</span>}
                <Link
                  href={step.href}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {step.label}
                </Link>
              </div>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
