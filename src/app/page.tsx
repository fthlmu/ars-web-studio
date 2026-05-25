// Landing page — entry point of the app.
// Populated with real content in Phase 7 (Polish).
// For now: a placeholder that confirms the app is running.

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-4">ARS Web Studio</h1>
      <p className="text-muted-foreground mb-8">
        Academic paper generator powered by the ARS pipeline.
      </p>
      <div className="flex gap-4">
        <a
          href="/intake"
          className="rounded-md bg-primary px-6 py-3 text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          Start New Paper
        </a>
      </div>
    </main>
  )
}
