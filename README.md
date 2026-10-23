# Lesson Studio

Internal tool for turning a unit outline into teacher-facing California Core ELA lessons: import the outline, check it, generate a draft of every lesson with Claude, review and edit together in real time, and approve a frozen copy for export.

## How it works

1. **Import.** A content expert uploads the outline (.xlsx or .csv) or pastes a Google Sheets link. Links are reduced to a sheet id and fetched only from `docs.google.com` (5 MB cap). Cell text is treated as untrusted data.
2. **Check the outline.** Each row is parsed and checked: unit number conflicts, duplicate lessons, malformed filenames, "Double Lesson" rows marked as one day, missing ELD codes, codes not in the grade 6 CA standards list, homework that doesn't lead into the next lesson, and cell text that reads like an instruction to an AI. Errors block generation until the expert decides; reviewer notes become generation constraints only if the expert opts in. Every decision records who made it.
3. **Generate.** One queued job per lesson, keyed by unit, lesson and prompt version, so a repeat click never pays twice. Each call reserves budget against the run's spend cap before it starts, so parallel jobs can't overshoot it. Output is structured JSON validated against the lesson schema, then checked: section minutes total 50 per day, every focus standard is taught, codes come from the row, ELD support matches the row, vocabulary matches, pulse checks have one correct answer, copyrighted texts are reference-only, and no quotation or page number appears that isn't in the outline row. Refusals and truncated output are flagged, not retried.
4. **Review together.** Each lesson is a shared document (Yjs over Hocuspocus, ProseMirror editor) with live cursors and presence. The editor's document mirrors the lesson schema node for node, so edited text converts back into a lesson for re-checking and export.
5. **Approve.** An approver freezes the current text: a snapshot, its SHA-256 and the approver are stored. Any later edit is detected by the collaboration server, revokes the approval, sends the lesson back to review, and is logged.
6. **Export.** Approved snapshots only, as JSON or HTML, with the CCSS copyright notice.

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
| `apps/web` | Next.js app: sign-in, import, outline checks, generation dashboard, editor, approval, review queue, export |
| `apps/worker` | Generation worker: BullMQ consumer, Claude call, output checks, spend cap |
| `apps/collab` | Hocuspocus server: per-lesson token auth, Postgres persistence, revoke-on-edit |
| `packages/db` | Drizzle schema, migrations, seed, shared generation helpers |
| `packages/schema` | Lesson schema, outline parser and checks, output checks, prompt v1, editor schema and converters, HTML export, standards list |
| `deploy` | Caddy config and the Lightsail deploy script |

Roles: **expert** (imports, decides outline flags, starts runs), **reviewer** (edits, regenerates), **approver** (approves, sends back), **admin** (all).

## Local development

Requirements: Node 22, pnpm 10, Postgres 16, Redis 7 (or Docker).

```bash
cp .env.example .env               # set AUTH_SECRET (32+ chars) and ANTHROPIC_API_KEY
pnpm install
pnpm db:migrate
SEED_PASSWORD=... pnpm db:seed     # demo accounts: expert@, reviewer@, approver@demo.local
pnpm dev                           # web on :3000, worker, collab on :1234
pnpm test                          # parser, checks, editor round-trip
```

Without an API key, run the worker with `GENERATION_FAKE=1` to get placeholder lessons (they fail the checks on purpose). The flag is refused when `NODE_ENV=production`.

Or run the whole stack: `docker compose up --build`, then open http://localhost.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis |
| `AUTH_SECRET` | Signs session cookies and collaboration tokens |
| `ANTHROPIC_API_KEY` | Claude API key (an API key, never a consumer account) |
| `GENERATION_MODEL` | Model id; configuration, not code. Default `claude-opus-5-5` |
| `UNIT_SPEND_CAP_USD` | Spend cap per generation run. Default 25 |
| `GENERATION_CONCURRENCY`, `GENERATION_ESTIMATE_USD`, `GENERATION_MAX_TOKENS` | Worker tuning |
| `NEXT_PUBLIC_COLLAB_URL` | Collaboration URL as the browser sees it (baked into the web build) |
| `SITE_ADDRESS` | Public hostname for Caddy; HTTPS is automatic |

## Deployment

One AWS Lightsail instance (4 GB, us-west-2) runs the compose stack behind Caddy, with a static IP and an `sslip.io` hostname. Only ports 80 and 443 are open, plus 22 for Lightsail's browser SSH. `python deploy/deploy.py` creates the instance; its first-boot script installs Docker, clones the repo with a read-only deploy token, writes `.env`, builds, migrates and seeds. Secrets are generated on first run and kept only in the instance's `.env` (they also travel in the instance's user data, which anyone with Lightsail access to the account can read).

## Security

- Sessions are signed JWT cookies (12 hours); passwords are hashed with Argon2. Every page and server action checks the role.
- The collaboration server admits a connection only with a two-hour token signed for that user and that lesson's room. Room names are random, not lesson ids.
- Outline text reaches the model fenced in a randomly tagged block, and the prompt treats it as data. Reviewer notes are used only after the expert confirms them.
- Google Sheets are fetched from Google only; there is no general URL fetch.

## Standards and content rules

- Standards are referenced by code and linked to the official source. The tool never paraphrases or stores standards text, and it does not bundle CA ELD standards text.
- Common Core State Standards: © Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.
- The generator never quotes the anchor novel or other in-copyright texts and never invents page numbers; the checks enforce this. It does not compute or state Lexile measures.
- The repo never contains the client brief, unit outlines, crawled lessons, or third-party texts. `.gitignore` blocks the usual paths; keep such files under `private/`.

**Disclaimer.** Generated lessons are drafts. The checks catch structural and sourcing problems, not every factual, pedagogical, or social-content issue. Every lesson needs human review and approval against California's instructional materials and social content standards before use.
