// SynthesisReport.tsx
// Displays the Stage 1 synthesis output: themes, research gaps, debates, consensus.
// The React component is named SynthesisReportView to avoid clashing with the
// SynthesisReport type imported from @/lib/types.

import type { SynthesisReport as SynthesisReportType } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

// ── prop type ──────────────────────────────────────────────────────────────────
interface SynthesisReportViewProps {
  synthesis: SynthesisReportType
}

// ── helper: pick a badge variant based on theme strength ──────────────────────
function strengthVariant(
  strength: SynthesisReportType["themes"][number]["strength"]
): "default" | "secondary" | "outline" {
  if (strength === "strong") return "default"
  if (strength === "moderate") return "secondary"
  return "outline" // emerging
}

// ── main component ─────────────────────────────────────────────────────────────
export function SynthesisReportView({ synthesis }: SynthesisReportViewProps) {
  const hasConsensus =
    Array.isArray(synthesis.consensusAreas) &&
    synthesis.consensusAreas.length > 0

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="themes">
        {/* ── tab list ── */}
        <TabsList>
          <TabsTrigger value="themes">
            Themes ({synthesis.themes.length})
          </TabsTrigger>
          <TabsTrigger value="gaps">
            Gaps ({synthesis.researchGaps.length})
          </TabsTrigger>
          <TabsTrigger value="debates">
            Debates ({synthesis.keyDebates.length})
          </TabsTrigger>
          {hasConsensus && (
            <TabsTrigger value="consensus">
              Consensus ({synthesis.consensusAreas.length})
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── themes tab ── */}
        <TabsContent value="themes">
          <div className="flex flex-col gap-3 pt-2">
            {synthesis.themes.map((theme, idx) => (
              <Card key={idx} size="sm">
                <CardHeader>
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle>{theme.name}</CardTitle>
                    {/* NFR-17: badge carries the WORD strong/moderate/emerging */}
                    <Badge variant={strengthVariant(theme.strength)}>
                      {theme.strength}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-card-foreground mb-3">
                    {theme.description}
                  </p>

                  {/* supporting sources */}
                  {theme.supportingSources.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Supporting sources
                      </span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {theme.supportingSources.map((id) => (
                          <Badge key={id} variant="secondary">
                            {id}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* contradicting sources */}
                  {theme.contradictingSources.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Contradicting sources
                      </span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {theme.contradictingSources.map((id) => (
                          <Badge key={id} variant="destructive">
                            {id}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {synthesis.themes.length === 0 && (
              <p className="text-sm text-muted-foreground">No themes found.</p>
            )}
          </div>
        </TabsContent>

        {/* ── gaps tab ── */}
        <TabsContent value="gaps">
          <div className="pt-2">
            {synthesis.researchGaps.length > 0 ? (
              <ol className="list-decimal list-inside flex flex-col gap-2">
                {synthesis.researchGaps.map((gap, idx) => (
                  <li key={idx} className="text-sm text-card-foreground">
                    {gap}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                No research gaps identified.
              </p>
            )}
          </div>
        </TabsContent>

        {/* ── debates tab ── */}
        <TabsContent value="debates">
          <div className="flex flex-col gap-3 pt-2">
            {synthesis.keyDebates.map((debate, idx) => (
              <Card key={idx} size="sm">
                <CardHeader>
                  <CardTitle>Debate {idx + 1}</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* two opposing positions side by side on wider screens */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Position A
                      </p>
                      <p className="text-sm">{debate.positionA}</p>
                      {Array.isArray(debate.sourcesA) &&
                        debate.sourcesA.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {debate.sourcesA.map((id) => (
                              <Badge key={id} variant="secondary">
                                {id}
                              </Badge>
                            ))}
                          </div>
                        )}
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Position B
                      </p>
                      <p className="text-sm">{debate.positionB}</p>
                      {Array.isArray(debate.sourcesB) &&
                        debate.sourcesB.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {debate.sourcesB.map((id) => (
                              <Badge key={id} variant="secondary">
                                {id}
                              </Badge>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>

                  {/* evidence balance summary */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Evidence balance
                    </p>
                    <p className="text-sm text-card-foreground">
                      {debate.evidenceBalance}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}

            {synthesis.keyDebates.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No key debates identified.
              </p>
            )}
          </div>
        </TabsContent>

        {/* ── consensus tab (conditional) ── */}
        {hasConsensus && (
          <TabsContent value="consensus">
            <div className="pt-2">
              <ul className="list-disc list-inside flex flex-col gap-2">
                {synthesis.consensusAreas.map((area, idx) => (
                  <li key={idx} className="text-sm text-card-foreground">
                    {area}
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

export default SynthesisReportView
