# Lesson Studio

Internal tool for generating, reviewing, and approving California Core ELA lessons from a unit outline.

Status: under construction. See the build plan for scope and the order of work.

## Local development

Requirements: Node 22, pnpm 10, Postgres 16, Redis 7 (or Docker).

```bash
cp .env.example .env          # fill in AUTH_SECRET and ANTHROPIC_API_KEY
pnpm install
pnpm db:migrate
SEED_PASSWORD=... pnpm db:seed   # demo expert, reviewer, approver accounts
pnpm dev
```

Or run everything with `docker compose up --build`.

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app: import, generation dashboard, editor, approval |
| `apps/worker` | Generation worker (job queue, Claude API) |
| `apps/collab` | Hocuspocus collaboration server (Yjs) |
| `packages/db` | Drizzle schema, migrations, seed |
| `packages/schema` | Lesson schema, outline parsing and validation, standards list |

## Content rules

The repo never contains the client brief, unit outlines, crawled lessons, or third-party texts. `.gitignore` blocks the usual paths; keep such files under `private/`.
