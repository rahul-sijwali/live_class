# Live Class

A shared maths worksheet for one mentor and one student. A question (image, animated GIF,
PDF page or typed text with LaTeX) is shown to both; each writes on top of it with freehand
ink, sees the other's writing live, and the work is saved. Video stays on Zoom.

- **How we build:** [`CLAUDE.md`](CLAUDE.md) (standards, process, invariants).
- **What exists:** [`live_class.md`](live_class.md) (architecture, every module, route, table,
  env var, decision, and how to run and deploy).

## Quick start (no database or Docker needed)

```bash
pnpm install
cp .env.example .env          # defaults use an embedded Postgres file and local disk storage
pnpm build                    # builds shared, core, react
pnpm dev                      # server on :4000, demo on :3000
```

Sign in at <http://localhost:3000/login/> with `admin@local.test`, `mentor@local.test` or
`student@local.test` (password `password123`). Create a session on the admin page, then open
the room as the mentor and the student in two browsers.

## Checks

```bash
pnpm check        # typecheck + lint + format + unit tests
pnpm test:e2e     # Playwright: real server + static demo, mentor and student contexts
```

## Packages

| Package              | Purpose                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `@live-class/shared` | Schemas, types, constants, permissions, API contract                                         |
| `@live-class/core`   | Framework-free engine: geometry, ink, realtime sync, question rendering, room store          |
| `@live-class/react`  | React components and hooks for a host app                                                    |
| `@live-class/server` | Fastify REST API + Hocuspocus realtime, Postgres (or embedded PGlite), S3-compatible storage |
| `apps/demo`          | Static Next.js demo that embeds the package like a host would                                |
| `e2e`                | Playwright suites                                                                            |
