// Claude API proxy — all AI calls from the browser go through here.
// The API key lives only on the server; the browser never sees it.
// Built out fully in Phase 3. This is a placeholder that returns a test response.

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  // Placeholder — Phase 3 will replace this with real Claude API streaming.
  const { agentPrompt, userMessage } = await req.json()

  return NextResponse.json({
    message: 'API route placeholder — Phase 3 will wire this to the Claude API.',
    received: {
      promptLength: agentPrompt?.length ?? 0,
      messageLength: userMessage?.length ?? 0,
    },
  })
}
