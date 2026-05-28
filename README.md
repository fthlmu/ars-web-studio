This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## ECC Recommendations

> This is the active code project (Next.js 16, TypeScript 5, React 19, Tiptap, `@anthropic-ai/sdk`, shadcn/ui, Tailwind 4). These ECC components are the highest-leverage tools for building and maintaining this codebase.

### Skills
| Skill | When to use |
|-------|------------|
| `frontend-patterns` | React component patterns, state management, and UI composition with shadcn/ui + Tailwind |
| `backend-patterns` | Next.js App Router API routes, server actions, and server-side data fetching patterns |
| `api-design` | Design the `/api/generate/route.ts` Claude API contract — streaming shape, error handling, retry logic |
| `e2e-testing` | End-to-end tests for the intake wizard flow and paper generation pipeline |
| `git-workflow` | Clean commit hygiene — one logical change per commit, good messages |
| `error-handling` | Structured error handling for Claude API failures, streaming interruptions, localStorage errors |
| `deployment-patterns` | Vercel deployment config, environment variable management, preview deployments |
| `coding-standards` | TypeScript conventions — keep types simple, well-commented, no complex generics |

### Agents
| Agent | How to invoke | When to use |
|-------|--------------|------------|
| `typescript-reviewer` | `Agent(typescript-reviewer)` | Review TypeScript code — types, null safety, React patterns, API route design |
| `code-reviewer` | `Agent(code-reviewer)` | General code review before completing a build phase |
| `code-architect` | `Agent(code-architect)` | Architecture decisions — component boundaries, state shape, API contract design |
| `planner` | `Agent(planner)` | Break a build phase (from `wiki/(C) BUILD_PLAN.md`) into concrete, ordered coding tasks |
| `build-error-resolver` | `Agent(build-error-resolver)` | Fix `pnpm build` / Next.js compilation errors |
| `e2e-runner` | `Agent(e2e-runner)` | Run and interpret end-to-end test results |
| `performance-optimizer` | `Agent(performance-optimizer)` | Optimize Claude API streaming, reduce re-renders, improve Time-to-First-Token UX |
| `security-reviewer` | `Agent(security-reviewer)` | Check that `ANTHROPIC_API_KEY` never leaks to browser code; scan for prompt injection vectors |
| `refactor-cleaner` | `Agent(refactor-cleaner)` | Clean up duplication and simplify components after a phase is working |

### Commands
| Command | When to use |
|---------|------------|
| `/ecc:plan` | Before starting a build phase — generates scoped task breakdown from `(C) BUILD_PLAN.md` context |
| `/code-review` | After completing a phase — TypeScript + React quality check |
| `/build-fix` | When `pnpm build` fails — Next.js 16 specific error resolution |
| `/quality-gate` | Before moving to the next build phase — verify no regressions |
| `/security-scan` | Before any deployment — API key exposure check, prompt injection audit |

### Hooks (auto-active via ECC plugin)
| Hook | What it does |
|------|-------------|
| TypeScript auto-format | Auto-formats `.ts`/`.tsx` files on save |
| `console.log` detector | Warns when `console.log` is left in production code |
| Secret detector | Alerts if an API key pattern appears in code being written |
