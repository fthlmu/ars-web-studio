---
name: api-route-doc
description: Read all API routes in src/app/api/ and output a clean request/response schema for each one
---

Read every `route.ts` file under `src/app/api/` in the ars-web-studio project.

For each route, output:

**Route: `/api/<name>`**
- Method: (GET / POST)
- Request body fields: list each field with its TypeScript type and whether it is required
- Response shape: list each field with its TypeScript type
- Streams: yes/no (does it use SSE / ReadableStream?)
- Notable: any error codes, rate-limit handling, or auth requirements worth knowing

Keep output concise — one block per route, no prose. This is a reference card, not an explanation.

Routes to cover (in this order):
1. `src/app/api/generate/route.ts`
2. `src/app/api/coaching/route.ts`
3. `src/app/api/export-pdf/route.ts`
4. `src/app/api/export-summary-pdf/route.ts`
5. `src/app/api/tools-chat/route.ts`
