# Lesson Studio

Internal tool for turning a unit outline into teacher-facing California Core ELA lessons: import the outline, check it, generate a draft of every lesson with Claude, review and edit together in real time, and approve a frozen copy for export.

## How it works

1. **Import.** A content expert uploads the outline (.xlsx or .csv) or pastes a Google Sheets link. Links are reduced to a sheet id (and tab, if the link names one) and fetched only from `docs.google.com` (5 MB cap). Cell text is treated as untrusted data. A sheet that repeats a lesson number is refused with the numbers to fix.
2. **Check the outline.** Each row is parsed and checked: unit number conflicts, duplicate lessons, malformed filenames, "Double Lesson" rows marked as one day, missing ELD codes, codes not in the grade 6 CA standards list, homework that doesn't lead into the next lesson, and cell text that reads like an instruction to an AI. Errors block generation until the expert decides; reviewer notes become generation constraints only if the expert opts in. Every decision records who made it.
3. **Generate.** One queued job per lesson, keyed by unit, lesson and prompt version, so a repeat click never pays twice. Before each call the worker reserves the call's worst-case cost (two requests at the output limit, at the highest model price) against the unit's cap and the day's cap in one transaction, then trues it up to the real cost. So parallel jobs, regenerations and AI suggestions together can't pass either cap. Output is structured JSON validated against the lesson schema, then checked. **Blocking** (the lesson is flagged and can't be approved): a missing section, section minutes not totalling 50 per day, a focus standard not in the front matter or not mapped to an activity, a code on no standards list, a pulse check without exactly one correct answer, an anchor text not marked reference-only, and a page number that isn't in the outline row. **Warnings** for the reviewer: codes not in the row, vocabulary that differs from the row, ELD support that doesn't match the row, brand names, Lexile, and quoted passages (8+ words) not found in the outline. Refusals and truncated output are flagged, not retried.
4. **Review together.** Each lesson is a shared document (Yjs over Hocuspocus, ProseMirror editor) with live cursors and presence. The editor's document mirrors the lesson schema node for node, so edited text converts back into a lesson for re-checking and export. Reviewers edit; experts and approvers get read-only connections, enforced by the collaboration server.
5. **AI suggestions.** A reviewer puts the cursor in a block and asks for a rewrite (clearer, simpler for grade 6, shorter, add a check for understanding, add English learner support, or their own request). The answer is a tracked suggestion, stored with the model that wrote it, shown as old and new text, and nothing changes until the reviewer clicks Apply. Apply is refused if the block changed since the suggestion was made or if another person's cursor is in it. Applied text carries an `ai` mark (highlighted in the editor) that records the suggestion and model; it does not change the lesson content or its hash.
6. **Approve.** An approver freezes the current text: a snapshot, its SHA-256 and the approver are stored. If the checks found quoted passages that aren't in the outline, the approver must confirm each is original or cleared, and that confirmation is stored with the approval. Any later edit is detected by the collaboration server, revokes the approval, sends the lesson back to review, and is logged.
7. **Export.** Approved snapshots only, as JSON or HTML, with the CCSS copyright notice.

## Architecture

```
browser ──https──▶ Caddy ─┬─▶ web (Next.js 16)  ──▶ Postgres
                          │        │ enqueue
                          │        ▼
                          │     Redis (BullMQ) ──▶ worker ──▶ Claude API
                          └─/collab─▶ collab (Hocuspocus) ──▶ Postgres
```

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app: sign-in, import, outline checks, generation dashboard, editor, AI suggestions, approval, review queue, export. `scripts/` holds the load tests |
| `apps/worker` | Generation worker: BullMQ consumer, Claude call, output checks, spend cap |
| `apps/collab` | Hocuspocus server: per-lesson token auth, Postgres persistence, revoke-on-edit |
| `packages/db` | Drizzle schema, migrations, seed, shared generation helpers |
| `packages/schema` | Lesson schema, outline parser and checks, output checks, prompt v1, editor schema and converters, HTML export, standards list |
| `deploy` | Caddy config and the Lightsail deploy script |

Roles: **expert** (imports, decides outline flags, starts runs), **reviewer** (edits, asks for AI suggestions, regenerates), **approver** (approves, sends back), **admin** (all). Every signed-in role can read every unit and lesson.

## Local development

Requirements: Node 22, pnpm 10, Postgres 16, Redis 7 (or Docker).

```bash
cp .env.example .env               # set AUTH_SECRET (32+ chars), SEED_PASSWORD and ANTHROPIC_API_KEY
pnpm install
pnpm db:migrate
pnpm db:seed                       # demo accounts: expert@, reviewer@, approver@demo.local
pnpm dev                           # web on :3000, worker, collab on :1234
pnpm test                          # parser, checks, prompts, sheet links, editor round-trip
```

Every app and script reads the root `.env` in development (variables already set in the shell win). Without an API key, set `GENERATION_FAKE=1` to get placeholder lessons (they fail the checks on purpose) and placeholder suggestions. The flag is refused when `NODE_ENV=production`.

Or run the whole stack: `docker compose up --build`, then open http://localhost.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis |
| `AUTH_SECRET` | Signs session cookies and collaboration tokens |
| `ANTHROPIC_API_KEY` | Claude API key (an API key, never a consumer account) |
| `GENERATION_MODEL` | Model id; configuration, not code. Default `claude-opus-5-5`. The Docker deployment sets it from `DEMO_GENERATION_MODEL` instead, default `claude-haiku-5-5`, so the hosted demo runs cheaply |
| `UNIT_SPEND_CAP_USD` | Spend cap per unit across all runs, regenerations and AI suggestions. Default 25 |
| `DAILY_SPEND_CAP_USD` | Spend cap across all units per UTC day. Default 100 |
| `GENERATION_CONCURRENCY`, `GENERATION_MAX_TOKENS` | Worker tuning |
| `SEED_PASSWORD` | Password for the demo accounts |
| `DB_POOL_MAX`, `COLLAB_PORT`, `GENERATION_API_BASE_URL` | Optional tuning |
| `NEXT_PUBLIC_COLLAB_URL` | Collaboration URL as the browser sees it (baked into the web build) |
| `SITE_ADDRESS` | Public hostname for Caddy; HTTPS is automatic |

## Deployment

One AWS Lightsail instance (4 GB, us-west-2) runs the compose stack behind Caddy, with a static IP and an `sslip.io` hostname. The Lightsail firewall opens only ports 80 and 443, plus 22 for Lightsail's browser SSH, and the web and collab containers publish their ports on loopback only. `python deploy/deploy.py` creates the instance; its first-boot script installs Docker, clones the repo with a read-only deploy token, writes `.env`, builds, migrates and seeds. A systemd timer then checks the deployed branch every two minutes and rebuilds when it changes (`deploy/update.sh`). Secrets are generated on first run and kept in the instance's `.env`. They also travel in the instance's user data, which anyone with Lightsail access to the account, and any process on the instance via the metadata service, can read; the first-boot script deletes its own copy when setup finishes. For production, fetch secrets from AWS Secrets Manager instead. The updater deploys whatever is pushed to the branch, so protect that branch.

To check a deployment end to end in a real browser (sign-in for each role, regenerate, AI suggestion, checks, approval, revoke-on-edit, export), run `E2E_PASSWORD=<demo password> pnpm --filter @nl/web e2e:live -- --base <url>`. It regenerates and edits one unapproved lesson, so it costs a few cents on Haiku.

## Security

- Sessions are signed JWT cookies (12 hours); passwords are hashed with Argon2. Every page requires sign-in, and every server action checks the role.
- Failed sign-ins are limited to 10 per account and 30 per address per 15 minutes. Generation runs (10 per hour), regenerations (30 per hour) and AI suggestions (60 per hour) are limited per user.
- The collaboration server admits a connection only with a two-hour token signed for that user and that lesson's room, and makes it read-only unless the user is a reviewer or admin. Room names are random, not lesson ids.
- All sheet-derived text (row, unit title, anchor text, neighbor summaries) reaches the model inside one randomly tagged block with angle brackets neutralized, and the prompt treats it as data. Reviewer notes become constraints only after the expert confirms them, but the cell text they sit in still reaches the model as data.
- The web app sends a Content-Security-Policy (no framing), nosniff and a referrer policy; Caddy adds HSTS.
- Google Sheets are fetched from Google only; there is no general URL fetch.

## Standards and content rules

- Standards are referenced by code and linked to the official source. The tool never paraphrases or stores standards text, and it does not bundle CA ELD standards text.
- Common Core State Standards: © Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.
- The prompt forbids quoting the anchor novel or other in-copyright texts and inventing page numbers or quotations. Page numbers not in the outline row block approval. Quoted passages of 8+ words not found in the outline are flagged, and the approver must confirm each before approving; unquoted or paraphrased passages are not detected, so review still matters. The tool does not compute or state Lexile measures.
- Commercial use of the Common Core standards needs NGA/CCSSO's license (request form, 12-month term, the notice above). Newsela's legal team should file the request; the CA ELD standards text is not bundled.
- The repo never contains the client brief, unit outlines, crawled lessons, or third-party texts. `.gitignore` blocks the usual paths; keep such files under `private/`.

## Performance

Measured on 2026-10-24 on a 4-core, 16 GB dev container with a production web build, a 41-lesson unit, and every simulated reviewer requesting pages back to back with no think time (so far heavier than 25 people reading). The scripts are in `apps/web/scripts` and send only GET requests or scratch Yjs edits.

| Test | 25 clients | 50 clients |
| --- | --- | --- |
| Review queue page, p50 / p95 | 266 / 360 ms | 531 / 609 ms |
| Lesson page, p50 / p95 | 219 / 288 ms | 420 / 492 ms |
| Throughput, errors | 109 req/s, 0 | 118 req/s, 0 |
| One lesson co-edited, edit reaches all others, p50 / p95 / max | 2.2 / 3.7 / 7.6 ms | 3.8 / 6.7 / 15.4 ms |

```bash
pnpm --filter @nl/web load:http   -- --base http://localhost:3000 --unit <unit id> --user <reviewer id> --clients 25
pnpm --filter @nl/web load:collab -- --url ws://localhost:1234 --lesson <lesson id> --room <collab room> --user <reviewer id> --clients 25
```

These numbers are from the dev container, not the Lightsail host; run the same scripts against the deployment before relying on them there.

## Known constraints

Deliberate limits of this build, so they aren't mistaken for oversights:

- **Prompt editing (bonus) is not built.** Prompts are versioned in `prompt_versions` and every lesson records and shows its prompt version, but only the seed creates one. An editor screen is the next step.
- **Authorship is recorded per suggestion, not per keystroke.** Text applied from an AI suggestion is marked in the document; other edits are recorded as "edited by people" for the lesson as a whole.
- **Editing is text-only.** Minutes, standards and vocabulary come from the outline and the generator and are read-only in the editor; change them by fixing the outline and regenerating.
- **"Published" means export.** Approved snapshots download as JSON or HTML with the standards notice. Pushing to Newsela's application needs their target format or API.
- **Social-content checks are prompts, not verdicts.** The checks flag brand names and Lexile; stereotyped portrayals and age-appropriateness are left to reviewers.
- **Google Sheets import needs link sharing.** A linked sheet must be "anyone with the link can view". Uploading .xlsx avoids that; production should use Google OAuth with a read-only scope.
- **Single tenant.** Every signed-in user can see every unit.

**Disclaimer.** Generated lessons are drafts. The checks catch structural and sourcing problems, not every factual, pedagogical, or social-content issue. Every lesson needs human review and approval against California's instructional materials and social content standards before use.
