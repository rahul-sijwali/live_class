# CLAUDE.md — Engineering standards for the Live Class project

This file is loaded at the start of every Claude Code session. It defines how code in
this repository is written, tested, documented and reviewed. Follow it for every change,
large or small. If a rule is wrong for a specific case, say so in the commit/PR and record
the exception in `live_class.md` → Decision log. Do not silently skip a rule.

---

## 1. What this project is (short version)

- A live 1:1 maths class **worksheet**. A question (image, animated GIF, PDF page, or typed
  text with LaTeX) is shown to a mentor and a student. Both write on top of it with
  freehand ink. Writing appears live on the other side and is saved.
- Admins upload questions to a **bank** with tags. A question reaches a session in three
  ways: pre-assigned before class, picked live from the bank by the mentor, or uploaded
  ad hoc by the mentor during class.
- **No video in this codebase.** Zoom runs next to the site. Do not add video dependencies.
- Delivered as an **npm package of React components** (over a framework-free TypeScript
  core) for a **Next.js host app we cannot see**, plus a separate **Node server**
  (REST + realtime). The host is integrated only through props, a token and callbacks.
- Owner priorities, in order: low running cost, painless integration into the host,
  reliability of live sync. Explain trade-offs in plain language.
- Full architecture, glossary, module map, routes and tables: **`live_class.md`**.
  Read the relevant sections before touching code.

## 2. Two documents, two jobs

| File                    | Answers                                                                            | Changes                |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| `CLAUDE.md` (this file) | **How** we build: standards, process, invariants                                   | Rarely                 |
| `live_class.md`         | **What** exists: packages, classes, functions, routes, tables, env vars, decisions | With every code change |

### live_class.md update rule (mandatory)

Any change that adds, removes, renames, or changes the behaviour of a package, module,
class, exported function, React component, hook, API route, realtime document or
message, DB table or column, environment variable, event, or a cross-cutting decision
**must update `live_class.md` in the same commit**. A code change without the doc update
is incomplete. Keep each item's status accurate (Planned / In progress / Implemented) and
link implemented items to their file path. Bump the "Last updated" line and add a row to
the document's changelog.

## 3. Working process

### Before writing code

1. Read the parts of `live_class.md` that cover the area you are changing.
2. For anything non-trivial, write the plan first and keep it in the PR description
   (or `docs/adr/NNNN-title.md` if it is a decision others must know about):
   - **HLD**: which packages/modules are touched, data flow, failure modes, what happens
     on disconnect or bad input, how it is tested end to end.
   - **LLD**: types, function signatures, state ownership, edge cases, the list of tests.
3. Changes touching **coordinates/geometry, realtime sync, permissions, upload
   validation, or auth** always get an explicit plan listing the invariants (§14) you are
   preserving.
4. Product questions (what the mentor should see, what a student may do) are the owner's
   to answer: ask. Technical choices are yours: pick the option that preserves the
   invariants and state the choice in the final message.

### While writing

- Smallest change that fully solves the problem. No speculative features, no "while I'm
  here" refactors in the same commit.
- Match surrounding style, naming and comment density.
- Write tests alongside the code, not afterwards.

### Before saying "done"

- `pnpm check` passes (typecheck, lint, format, unit tests). Run the relevant E2E suite
  for any UI or sync change.
- `live_class.md` is updated.
- Report honestly: what was verified by running, what was only reviewed by reading, and
  what was skipped. Never claim tests pass that were not run.

## 4. High-level design rules

- **Layering and dependency direction** (enforced by ESLint import rules and
  `package.json` dependencies):
  `shared ← core ← react` and `shared ← server`.
  `core` never imports React, any UI framework, or server code. `shared` has no runtime
  dependency except `zod`. `server` never imports `core` or `react`.
- **Validate at every boundary.** HTTP bodies, query strings, WebSocket auth payloads,
  uploaded files, environment variables and host tokens are parsed with the Zod schemas in
  `shared`. Never trust the client; never trust a filename or a declared MIME type.
- **Adapters for external systems.** Storage (local disk / S3-compatible), authentication
  (host token / local dev login) and document persistence sit behind one interface each,
  chosen by config. Business code depends on the interface, never on the vendor SDK.
- **One owner per piece of state.** Collaborative sheet state (strokes, sheet height,
  current sheet) lives in Yjs documents. Authoritative records (users, sessions,
  questions, assets) live in Postgres behind the REST API. Never hold the same fact in
  both.
- **Fail loudly at startup, degrade gracefully at runtime.** Bad config stops the process
  with a clear message. Network loss shows a status, retries with backoff and keeps local
  work.
- **Host integration contract.** The React package receives `apiBaseUrl`, `realtimeUrl`,
  a token and callbacks. It never reads the host's cookies, globals, router, or store.
  All styles are scoped. Components are client-only and SSR-safe (no `window` at module
  scope).
- **Horizontal scaling is a design input.** No in-memory state that a second server
  instance would need. Realtime fan-out across instances goes through Redis when enabled.

## 5. Low-level design rules

- **TypeScript strict everywhere**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. No `any`; use `unknown` and narrow.
  No `as` casts except at a validated boundary, with a comment saying why it is safe.
- **Types model the domain.** Discriminated unions for kinds (`QuestionKind`, tool kinds,
  connection status). Branded IDs (`SheetId`, `SessionId`, …) so IDs cannot be mixed up.
  `readonly` by default. TS types are derived from Zod schemas (`z.infer`) so there is one
  source of truth.
- **Functions** are small and single-purpose; pure where possible; side effects pushed to
  the edges. Guideline: ≤ 40 lines, ≤ 4 parameters (use an options object beyond that).
- **Naming**: verbs for functions (`computeSheetGeometry`), nouns for values, `is/has/can`
  for booleans, units in names (`widthPx`, `xSheet`, `timeoutMs`, `heightUnits`).
  No abbreviations that a new developer would have to guess.
- **Immutability**: never mutate inputs; return new values. The one exception is a Yjs
  transaction, which is wrapped in a method whose comment says so.
- **Errors**: one `AppError` class with a stable `code` from `shared/errors`; the
  HTTP mapping lives in one place on the server. Never swallow an error. Log once, at the
  boundary, with context. User-facing text is separate from internal messages. Never
  `throw "string"`.
- **Async**: every promise is awaited or explicitly `void`ed with a comment. Cancellable
  work takes an `AbortSignal`. Every network call has a timeout.
- **Resource cleanup**: anything that subscribes, listens, opens a connection, or creates a
  DOM node exposes `dispose()`. React effects return cleanups. Tests assert that `dispose`
  leaves nothing behind.
- **No magic numbers.** Named constants in `shared/constants.ts`, each with a comment on
  why that value.
- **Config, not scattered env reads.** One validated `Config` object built at startup.
- **Dates** travel as ISO 8601 strings; `Date` objects only at the edges; UTC in the DB.
- **IDs** are UUID v7 (time-sortable). Never expose DB row counts or sequential ints.

## 6. Comments and in-code documentation

Goal: a reader (a developer or Claude browsing the code) understands what a function does,
what it takes, what it returns and why it exists **without reading the body**.

### Rules

- **File header** (3–8 lines): what this module owns, what it deliberately does not do,
  the invariants it relies on.
- **Every exported** function, class, method, type, React component, hook and constant
  gets a JSDoc block (TypeScript flavour, enforced by `eslint-plugin-jsdoc`) with:
  - a one-sentence summary of _what_ it does (not how);
  - `@param {Type} name - meaning, units, valid range or constraints` for **every**
    parameter. Include the type even though TypeScript already knows it; the comment must
    stand on its own when read in a diff, a search result, or a tooltip;
  - `@returns {Type} meaning`, including what comes back on the empty or failure case
    (or "Nothing." for `void`);
  - `@throws {ErrorType} when …` for every error the caller can see;
  - `@example` when usage is not obvious from the signature;
  - `@remarks` for invariants, performance notes and concurrency notes.
- **React props**: document each field of the props interface with the same `{Type}`
  convention; document the component with what it renders and which callbacks it fires.
- **Inside bodies**: comment the **why**, not the what. Non-obvious branches, workarounds
  (link the issue), coordinate maths, tolerances, and ordering constraints get a comment.
  Do not narrate obvious code.
- **No stale comments.** A change that alters behaviour updates the comment in the same
  edit.
- **No commented-out code.** Git keeps history.
- **TODOs** are written as `// TODO(owner, YYYY-MM-DD): … (link)` or not at all.

### Template

```ts
/**
 * Converts a pointer position in CSS pixels into sheet units so the point can be stored
 * and shared independently of zoom level and device.
 *
 * @param {number} clientX - Pointer X in CSS pixels, from `PointerEvent.clientX`.
 * @param {number} clientY - Pointer Y in CSS pixels, from `PointerEvent.clientY`.
 * @param {ViewportState} viewport - Current sheet origin in pixels and scale in pixels
 *   per sheet unit. `scale` must be greater than 0.
 * @returns {SheetPoint} The point in sheet units. `x` is within `[0, LOGICAL_WIDTH]` when
 *   the pointer is over the sheet and outside that range when it is in the side margin.
 * @throws {RangeError} If `viewport.scale` is 0, negative or `NaN`.
 * @example
 *   const p = toSheetPoint(event.clientX, event.clientY, viewport.state);
 */
export function toSheetPoint(
  clientX: number,
  clientY: number,
  viewport: ViewportState,
): SheetPoint { … }
```

## 7. Testing

### Pyramid and tools

- **Unit** (Vitest): `shared`, `core`, `server` logic. Fast, no network, no real DB.
- **Component** (Vitest + jsdom + Testing Library): `react` components and hooks.
- **API** (Fastify `inject` + a real Postgres via testcontainers or a per-test
  transaction): every route, success and failure paths.
- **E2E** (Playwright): critical flows against the demo app with **two browser contexts**
  (mentor and student) so live sync is asserted, not assumed.
- **Visual** (Playwright screenshots): ink alignment on each question kind at two viewport
  widths and two device pixel ratios.
- **Performance**: a benchmark for rendering 5 000 strokes and for simplification; fails on
  regression beyond a set budget.

### What must always be tested

Coordinate transforms (round trips, DPR, scale), stroke simplification, hit-testing,
Yjs document API (concurrent edits merge, per-user undo), permission policies, upload
validation (wrong MIME, polyglot files, oversize, too many pages), auth (expired, wrong
issuer, wrong audience, tampered token), each question renderer, reconnection, and
`dispose()` cleanliness.

### Test quality

- Deterministic: fake timers, seeded data, no sleeps.
- Isolated: fresh state per test; no order dependence.
- Fast: unit suite under 60 s.
- Readable: Arrange–Act–Assert; names describe behaviour
  (`it('rejects a GIF larger than MAX_UPLOAD_MB')`).
- Test behaviour through public APIs, not implementation details.
- Every bug fix starts with a failing regression test.
- No `.only` or `.skip` committed. A flaky test is fixed or deleted the same day.

### Coverage gates (CI fails below; configured in `vitest.config.ts`)

- Overall: 80 % statements and lines, 78 % functions, 68 % branches.
- Critical modules (`core/geometry`, `core/sync`, `server/authz`,
  `server/services/asset-validation.ts`): 90–95 % statements and lines, 75–85 % branches.
- Branch coverage is deliberately lower than statement coverage: defensive branches in
  validation and sync code inflate the denominator. Raise a gate only after the suite clears
  it; never lower one to make a change pass.

## 8. Security and privacy

- **Students may be minors.** Collect minimal personal data: display name, role, the host's
  user id. No emails or phone numbers except for the local dev login. Retention is
  configurable; a delete-user endpoint removes their data and strokes' author links.
- **Authentication**: host-issued short-lived JWT, verified against a shared secret or the
  host's JWKS. Local email/password login exists only for development and standalone
  demos and is disabled by config in production.
- **Authorization on the server for everything**: every REST route and every realtime
  document open checks that the user is a participant of that session with the required
  role. Client-side checks are for UX only.
- **Uploads**: detect type by content sniffing (`file-type`), never by extension or header;
  allowlist `image/png`, `image/jpeg`, `image/gif`, `application/pdf` only (no SVG);
  enforce size, dimension and page-count limits; reject PDFs containing JavaScript or
  embedded files; storage key is a generated id, never the filename; serve with
  `Content-Disposition`, `X-Content-Type-Options: nosniff`, `Cache-Control: private`.
- **Rendered text**: Markdown → HTML passes through DOMPurify with an allowlist. KaTeX
  runs with `throwOnError: false`, `trust: false`, and `maxExpand`/`maxSize` limits.
- **No `eval`, no `new Function`.** Mathematical expressions go through a parser with an
  allowlist of functions.
- **Secrets** only via environment; `.env.example` documents every variable; never log
  tokens, passwords or file contents.
- **Dependencies**: lockfile committed; `pnpm audit` in CI; automated update PRs; a new
  dependency needs a one-line justification in the PR and a licence check.
- **HTTP hardening**: Helmet, CORS allowlist from config, rate limits on auth, upload and
  search, request body limits.
- **Logs**: structured, ids only, no personal data.

## 9. Performance budgets

- Local ink: pointer event to pixels on screen within one frame (16 ms). No allocations in
  the `pointermove` hot path beyond the point buffer.
- Remote ink: visible on the peer within 200 ms on a normal connection. In-progress points
  stream over awareness; the finished stroke is committed on pointer-up.
- Committed strokes live on their own canvas and are redrawn only when the set changes;
  only the in-progress stroke is redrawn per frame.
- First paint of an image question within 2 s on 4G. `pdf.js` and KaTeX are lazy-loaded.
- Package size: `core` + `react` ≤ 150 kB gzipped excluding lazy chunks; CI fails on
  regression (`size-limit`).
- Server: p95 under 200 ms for non-upload routes. Realtime servers are stateless so they
  scale horizontally.
- Measure before optimising; keep the numbers in the PR.

## 10. Accessibility and UX basics

- Every toolbar control is keyboard-operable with a visible focus ring and an ARIA label.
- Colour is never the only signal (role is shown by label and colour).
- Contrast meets WCAG AA. `prefers-reduced-motion` is respected where the browser allows
  (animated GIFs cannot be paused; this is a known limitation).
- Alt text is required when uploading a question; it is used by screen readers and search.
- Touch targets ≥ 44 px; the room works at 360 px width.
- Connection state (connected / reconnecting / read-only) is always visible.

## 11. Observability and operations

- `pino` structured logs with `requestId`, `sessionId`, `userId` (ids only); log levels
  used consistently (`error` = needs a human, `warn` = degraded, `info` = lifecycle,
  `debug` = development).
- `/healthz` (process alive), `/readyz` (DB, storage, Redis reachable), `/metrics`
  (Prometheus: request latency, open WebSocket connections, loaded documents, upload
  failures).
- Client errors are caught by an error boundary and passed to the host's `onError`
  callback; the host decides on its own error-reporting service.
- Migrations are forward-only, reviewed, and run in CI against a fresh database. A shipped
  migration is never edited.
- Graceful shutdown: stop accepting connections, flush Yjs documents to the database,
  close pools.
- Backups for Postgres and object storage, with a documented restore drill.

## 12. Git, commits and pull requests

- One branch per change. Conventional Commits:
  `feat(core): …`, `fix(server): …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`.
  The body explains **why**.
- PR template: what and why, HLD/LLD notes, screenshots or a short recording for UI
  changes, test evidence, "live_class.md updated" checkbox, risk and rollback.
- Keep PRs small (about 400 changed lines) unless the change is mechanical.
- At least one reviewer. Reviewers check the Definition of Done (§15) and design; tools
  check style.
- Never commit secrets, generated artefacts, or `.only` tests. Never force-push a shared
  branch.

## 13. Tooling (one command surface)

- `pnpm` 12 workspaces; Node 24 pinned in `.nvmrc` (`engines` ≥ 22.12). No Docker or database
  install is needed for development or tests: `DATABASE_URL=pglite://…` runs an embedded Postgres.
- `pnpm check` = typecheck + lint + format check + unit tests.
  `pnpm test:e2e`, `pnpm dev` (server + demo app), `pnpm db:migrate`, `pnpm build`.
  Exact scripts are listed in `live_class.md` → How to run.
- ESLint 10 flat config: `typescript-eslint` strict type-checked, `eslint-plugin-jsdoc` (the
  documentation policy in §6, TypeScript flavour), `@eslint-react` + `react-hooks` (React 19
  rules: no refs during render, no setState in effects) and `jsx-a11y`; Prettier; strict
  `tsconfig`; `husky` + `lint-staged` pre-commit; GitHub Actions on every PR: check (typecheck,
  lint, format, coverage), E2E, size-limit + audit, Docker image build.

## 14. Project invariants (never break these)

1. **Fixed logical sheet width.** A sheet is `LOGICAL_WIDTH` (1000) units wide. It is
   scaled as a whole to fit the viewport and never reflowed. All ink is stored in sheet
   units. _Why:_ ink must sit on the same part of the question on every device.
2. **Ink never bloats the shared document.** In-progress points travel over awareness
   (ephemeral). Only the finished, simplified stroke is written to the Yjs document.
3. **One Y.Doc per sheet and one per session**, named `sheet:<id>` and `session:<id>`.
   The server authorises every document open.
4. **The server is the authority** for who is in a session and with what role. Yjs holds
   only collaborative sheet state.
5. **Assets are immutable.** A changed file is a new asset. Sheets reference an asset id
   plus a page index.
6. **The React package knows nothing about the host.** Props in, callbacks out, scoped
   styles, client-only.
7. **No video code or dependencies.**
8. **Everything that can be disposed, is.**

## 15. Definition of Done

- [ ] Plan (HLD/LLD) written for any non-trivial change
- [ ] Code follows §4–§6; doc block on every export with `@param {Type} name` and
      `@returns {Type}` (ESLint enforces this; `pnpm lint` must be clean)
- [ ] Unit, component and API tests added; E2E for sync or UI flows; coverage gates pass
- [ ] `pnpm check` and the relevant E2E suite are green locally
- [ ] Security checklist (§8) considered for any boundary change
- [ ] `live_class.md` updated: modules, functions, routes, tables, env vars, decisions,
      statuses, changelog
- [ ] Commit messages explain why; PR template filled in
- [ ] Final message reports honestly what was run, what was read, what was skipped
