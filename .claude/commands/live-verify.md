# /live-verify

Run the true ARS Web Studio live-model browser smoke test.

This command is for the manual owed golden-path check. It must use the real app and the real `.env.local` Claude API key. It must not become a smaller mocked test unless the real path is blocked.

## Hard rules

1. Do not commit anything.
2. Do not redesign this into a smaller test.
3. Do not mock `/api/generate` or `/api/coaching`.
4. Do not use seeded localStorage as a substitute for intake unless the normal intake UI is broken.
5. Use the real browser flow from `/intake` to export.
6. If a real blocker appears, stop and report exactly what blocked progress.
7. If a Claude hard usage/rate limit appears, stop and report the reset time if shown. Do not force the run.
8. Track whether real `/api/generate` calls happened. The final report must say the count or the exact evidence.
9. Track whether `/api/coaching` happened. If coaching is skipped by design, say that clearly.
10. Track whether export was reached and which export button worked.

## Goal

Prove this full live path works:

Intake → Research → Write/Outline → Section Review → 2.5 Integrity Gate → Peer Review → Coaching/Skip → Revision → Re-review → Final Integrity Gate → Finalize/Export

## Before starting

1. Confirm current folder is the app root:
   `D:/OneDrive/AI_Brain_Fathul/projects/vibe-code-paper-generator/projects/ars-web-studio`
2. Confirm `.env.local` exists and contains `ANTHROPIC_API_KEY`.
3. Confirm no old dev server is already using port 3000. If port 3000 is busy, identify it and stop only if it belongs to this app.
4. Start the app with `pnpm dev` if needed.
5. Open the app in the browser.
6. Install network listeners or use browser/dev server logs to count real requests to:
   - `/api/generate`
   - `/api/coaching`
   - `/api/export-pdf` if PDF is attempted

## Fixed intake values

Use these exact values so the run is deterministic and cheap:

- Topic: `Short practical review of hybrid beamforming for mmWave phased arrays`
- Research question: `How does hybrid beamforming help mmWave phased-array systems balance beamforming performance and hardware complexity?`
- Paper type: choose `IMRaD` if available; otherwise choose the closest normal research-article option.
- Target journal: skip if the UI allows skip; otherwise use `IEEE Access`.
- Citation format: `IEEE`.
- Output format: choose `Markdown` first. Also keep `LaTeX` if already selected. Do not require PDF until the final export page.
- Language: `English`.
- Bilingual abstract: `No` / off.
- Word count: choose the shortest allowed option. If free text, use `800`.
- Existing materials: select `No existing materials` or leave all unchecked.
- Author:
  - Name: `Fathul`
  - Affiliation: `KAIST MALAB`
  - Email: leave blank unless required; if required use `fathul@example.com`.
  - Corresponding author: yes.
- Writing style: skip if the UI allows skip; otherwise use `clear, concise, academic`.
- Funding: no funding.
- Conflict of interest: `The authors declare no conflicts of interest.`

## Human decision rules

Use these rules whenever the app asks for a human decision.

### Outline / draft review

- If the outline appears and has an approve button, approve it.
- If sections appear and `approve-draft` is visible, click it.
- Do not edit the paper unless the app blocks approval.

### Stage 2.5 Integrity Gate

- Wait for the real integrity result.
- If PASS and `proceed-to-review` is visible, click it.
- If FAIL, stop. Report the failure details and do not bypass.
- If bounded override appears, do not use it in this smoke test. Stop and report that a human judgment is required.

### Peer Review

- Wait for the real review result.
- If `review-accept` is visible, click it. This is preferred because it is the shortest valid path.
- If accept is not visible but `review-request-revision` is visible, click request revision.
- If only reject is available, stop and report the review result.

### Coaching

- If coaching appears, choose `coaching-skip`.
- Reason: this is a smoke test. We only need to prove the pipeline can move forward; we do not need a long coaching conversation.
- If skip is not available, send exactly one short reply: `Please revise the draft using the reviewer comments.` Then proceed when possible.

### Revision

- Wait for the real revision result.
- If `revision-approve` is visible, click it.
- If revision fails or times out, stop and report the exact error.

### Re-review

- Wait for the real re-review result.
- If `re-review-proceed-final-gate` is visible, click it.
- If `re-review-request-final-revision` is visible and the app requires it, use it only once, then skip residual coaching if it appears, approve revision, and return to re-review.
- If the revision loop cap appears, proceed to final gate if available.

### Final Integrity Gate

- Wait for the real final integrity result.
- If PASS and `export-button` is visible, click it.
- If FAIL, stop. Report the failure details. Do not bypass.

### Finalize / Export

- Wait for the finalize page.
- First click `export-markdown`.
- If LaTeX is available, click `export-latex`.
- If DOCX is available, click `export-docx`.
- Try PDF only if the PDF button is enabled. If Typst is missing, report that PDF is blocked by Typst, but Markdown/LaTeX/DOCX may still count as export success.

## Success criteria

The run is successful only if all are true:

1. Intake was completed in the browser.
2. At least one real `/api/generate` call happened.
3. The pipeline reached `/pipeline/finalize`.
4. At least one export action worked, preferably Markdown.
5. The final report states:
   - real `/api/generate` calls: yes/no + evidence/count
   - real `/api/coaching` calls: yes/no + reason if skipped
   - final route reached
   - export format(s) tested
   - any errors or warnings

## Stop-and-report blockers

Stop immediately and report if any of these happen:

- Missing `.env.local` or missing `ANTHROPIC_API_KEY`.
- Claude hard usage/rate limit.
- App cannot start.
- Browser automation cannot open the app.
- Real `/api/generate` fails with 401, 403, 429, 500, parse error, or empty response.
- A required human gate fails and no valid forward button appears.
- Integrity gate FAIL.
- Final integrity gate FAIL.
- Export page cannot be reached.

## Final report format

Use this exact report shape:

```
LIVE VERIFY RESULT: PASS or BLOCKED or FAIL

What I tested:
- Intake: done/not done
- Real /api/generate calls: yes/no, count/evidence
- Real /api/coaching calls: yes/no, count/evidence or skipped by rule
- Reached final export page: yes/no
- Export tested: markdown/latex/docx/pdf

Where it stopped:
- route/page:
- visible error:
- console/server error:
- likely cause in simple words:

Files changed:
- list files changed, or `none`

Next recommended fix:
- one simple next action
```
