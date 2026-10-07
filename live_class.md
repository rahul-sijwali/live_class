# live_class.md — How the Live Class code is structured

> **Living document.** Describes the _current_ state of the codebase: every package,
> module, class, exported function, route, table, environment variable and decision.
> It is updated in the same commit as any code change (rule in `CLAUDE.md` §2).
>
> **Status tags:** 🟡 Planned · 🔵 In progress · 🟢 Implemented (file path given)
>
> **Last updated:** 2026-10-07 — deployment prep for the free demo (Render Singapore + Supabase);
> code on GitHub, CI green for build, tests and Docker image.

---

## 0. Status summary

| Area                                               | Status         | Evidence                                                                        |
| -------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| Repository scaffold (pnpm workspace, tooling, CI)  | 🟢 Implemented | `pnpm check` green; `.github/workflows/ci.yml`                                  |
| `@live-class/shared`                               | 🟢 Implemented | 55 unit tests                                                                   |
| `@live-class/core`                                 | 🟢 Implemented | 115 unit tests (jsdom)                                                          |
| `@live-class/react`                                | 🟢 Implemented | 19 component tests                                                              |
| `@live-class/server`                               | 🟢 Implemented | 60 tests incl. API over embedded Postgres and a live WebSocket sync test        |
| `apps/demo` (static Next.js)                       | 🟢 Implemented | `next build` → 5 static pages                                                   |
| End-to-end suites                                  | 🟢 Implemented | 3 Playwright tests, two browser contexts (mentor + student)                     |
| Deployment artefacts (Dockerfile, Render, compose) | 🟢 Implemented | Docker image **built successfully in GitHub CI** (no Docker on the dev machine) |
| Free demo deployment                               | 🔵 In progress | Code on GitHub; Supabase + Render accounts not created yet (§14.3)              |

Totals: 249 unit/component/API tests, coverage 90 % statements / 93 % lines / 76 % branches
(gates in `vitest.config.ts`), bundle 63 kB (core) / 68 kB (react) brotli for the main chunk.

---

## 1. Product context

- **Who uses it:** an _admin_ (the owner's team), _mentors_ and _students_. Classes are
  always 1:1 (one mentor, one student). About 10 000 students; video stays on Zoom.
- **What happens in a session:** a question appears for both people. Each writes on top of
  it, over the question itself or in the blank space above and below. Each sees the
  other's writing live. The work is saved and can be reopened read-only after the class.
- **Question kinds:** image (PNG/JPG), animated GIF (a PowerPoint slide exported as GIF),
  PDF (each page becomes its own sheet), typed text with LaTeX maths.
- **How a question reaches a session:** pre-assigned by an admin; picked live from the bank
  by the mentor; or uploaded ad hoc by the mentor during class.
- **Delivery:** an npm package of React components that the owner's existing Next.js
  project imports, plus a separately deployed Node server. The host project's code is not
  available to us; integration goes only through the contract in §13.
- **Out of scope (for now):** video, handwriting-to-maths recognition, stroke replay,
  pinch-zoom (v1 is fit-to-width with vertical scroll), group classes.
- **Deployment constraint:** the first version is a demo for one mentor and one student
  at a time with **zero hosting spend** (free tiers only, no payment card anywhere). The
  same code must later scale by changing configuration and hosting plans, never code (§14).

## 2. Glossary

| Term                     | Meaning                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Question**             | A bank item: title, kind, tags, alt text, and either an asset (image/GIF/PDF) or Markdown text. Content immutable; metadata editable. |
| **Asset**                | An uploaded file in object storage with validated type, size, page sizes, SHA-256 and (for raster files) a thumbnail. Immutable.      |
| **Page**                 | One renderable unit of a question. Images, GIFs and text have one page; a PDF has one per PDF page.                                   |
| **Sheet**                | The writable surface for one page inside one session: the page plus blank margins, with its own ink document.                         |
| **Session**              | One scheduled class: participants, ordered sheets, status (`scheduled`, `live`, `ended`).                                             |
| **Participant**          | A user in a session with a role: `mentor` or `student`. Admins manage sessions and may observe read-only.                             |
| **Stroke**               | One finished pen/highlighter mark: author, tool, colour, width, simplified points in sheet units, bounding box, creation time.        |
| **Sheet units**          | The logical coordinate system: every sheet is `LOGICAL_WIDTH = 1000` units wide; height depends on content and margins.               |
| **Awareness / presence** | Ephemeral per-connection state (who is here, which sheet they view, follow mode, the pen stroke in progress). Not persisted.          |
| **Follow mode**          | Student setting: when on, the student's view switches to whichever sheet the mentor makes current.                                    |
| **Host**                 | The owner's existing Next.js application that embeds the React package.                                                               |
| **Bank**                 | The searchable collection of questions managed by admins.                                                                             |
| **Room store**           | `RoomStore` (core): the observable object that loads a session, joins its realtime document and decides what the user is viewing.     |

## 3. System architecture (HLD)

```
┌─────────────────────────── Host Next.js app (not in this repo) ───────────────────────────┐
│  Host backend mints a short-lived JWT for the logged-in user   →   <LiveClassProvider token> │
│                                                                    <LiveClassRoom />        │
│                                                                    <QuestionBank /> <SessionSetup /> │
└──────────────────────────────────────┬────────────────────────────────────────────────────┘
                                       │ imports
                     ┌─────────────────▼──────────────────┐
                     │  @live-class/react  (React 19)      │
                     │  components + hooks, scoped CSS     │
                     └─────────────────┬──────────────────┘
                                       │ uses
                     ┌─────────────────▼──────────────────┐
                     │  @live-class/core  (framework-free) │
                     │  RoomStore · SheetController        │
                     │  geometry · ink · sync · renderers  │
                     │  LiveClassApi (typed client)        │
                     └───────┬──────────────────┬─────────┘
                 REST/JSON   │                  │ WebSocket /realtime (Yjs sync + awareness)
                             │                  │
┌────────────────────────────▼──────────────────▼──────────────────────────────────────────┐
│  @live-class/server  (Node 24, Fastify 5 + Hocuspocus 4)                                  │
│  auth (host JWT / dev login) · authz · questions · assets · sessions · sheets · realtime   │
└───────┬───────────────────────────┬───────────────────────────────┬──────────────────────┘
        │                           │                               │ (optional)
  ┌─────▼──────┐             ┌──────▼───────┐                 ┌─────▼─────┐
  │ PostgreSQL │             │ Object store │                 │   Redis   │
  │ or PGlite  │             │ local disk / │                 │ multi-    │
  │ (embedded) │             │ S3-compatible│                 │ instance  │
  └────────────┘             └──────────────┘                 └───────────┘
```

`shared ← core ← react` and `shared ← server` (dependency direction enforced by ESLint).

### Key flows (all implemented and covered by tests)

**A. Admin uploads a question** — `QuestionBank` form → `POST /assets` (multipart) →
`AssetService.createFromUpload` sniffs the type by content, checks limits, reads page sizes,
makes a thumbnail, stores the file (de-duplicating by SHA-256) → `POST /questions` with
`assetId` (or `textMarkdown`) → `questions` row.

**B. Session created and joined** — `SessionSetup`: `POST /sessions`, `POST /sessions/:id/participants`
(one mentor, one student), optional `POST /sessions/:id/questions` (pre-assign) → each
participant opens the room → `RoomStore` loads `GET /sessions/:id` + `/sheets`, opens
`session:<id>` over the WebSocket (authorised server-side), joins presence.

**C. Mentor opens a question** — `QuestionPicker` (planned list, bank search, or ad hoc
upload) → `POST /sessions/:id/questions/:questionId/open` → `SessionService.openQuestion`
creates one `sheets` row per page (geometry from the asset's page size; provisional for
text), marks the question opened, moves `scheduled → live` → `appendSheetsToSession`
writes the sheet ids into the session document → both clients see the new sheet and open
`sheet:<id>`.

**D. Drawing a stroke** — `InkLayer` pointer-down → `StrokeBuilder` collects points and
draws on the live canvas; `Presence.streamPen` broadcasts them (throttled 30 Hz) so the
peer paints the stroke as it happens → pointer-up → `StrokeBuilder.end()` simplifies →
`SheetDoc.addStroke` commits to the Yjs map → both clients repaint the committed canvas →
Hocuspocus persists the document to `yjs_documents` (debounced 2 s, max 10 s).

**E. Undo** — `SheetDoc` uses a `Y.UndoManager` tracking only the local origin, so each
person undoes only their own strokes; the removal syncs to the peer.

**F. Reconnect** — `RealtimeClient` maps socket events to `connecting | connected |
disconnected | unauthorized | readonly`; the UI shows the state and tools lock when the
server granted read-only scope. Yjs merges offline edits on reconnect.

**G. Session ends** — `POST /sessions/:id/end` → status `ended`; new document opens are
read-only (`onAuthenticate` sets `connectionConfig.readOnly`), the room disables tools.

## 4. Repository layout

```
live_class/
├─ CLAUDE.md, live_class.md, README.md
├─ package.json (pnpm workspace root: check / dev / build / test / test:e2e / size)
├─ pnpm-workspace.yaml, tsconfig.base.json, tsconfig.json, eslint.config.js, vitest.config.ts
├─ .size-limit.json, .prettierrc, .editorconfig, .nvmrc (24), .npmrc, .env.example
├─ Dockerfile, .dockerignore, render.yaml, docker-compose.yml
├─ .github/workflows/ci.yml, .github/pull_request_template.md, .husky/pre-commit
├─ docs/adr/README.md
├─ packages/
│  ├─ shared/   @live-class/shared  — schemas, types, constants, geometry maths, permissions, API contract
│  ├─ core/     @live-class/core    — framework-free engine (+ `@live-class/core/testing` fake realtime)
│  ├─ react/    @live-class/react   — React components, hooks, styles.css
│  └─ server/   @live-class/server  — Fastify API + Hocuspocus realtime; drizzle/ holds SQL migrations
├─ apps/demo/   static Next.js demo (login, admin, room); e2e target
└─ e2e/         Playwright config and suites
```

## 5. Packages and modules

Every file below is 🟢 implemented unless stated. Signatures are abbreviated; the source
carries full doc blocks with `@param {Type}` and `@returns {Type}` (enforced by ESLint).

### 5.1 `@live-class/shared` (`packages/shared/src`)

Runtime dependencies: `zod`, `uuid`.

| File                  | Owns                                 | Key exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.ts`        | Every tunable number with its reason | `LOGICAL_WIDTH` 1000, `DEFAULT_MARGIN_TOP_UNITS` 120, `DEFAULT_MARGIN_BOTTOM_UNITS` 600, `ADD_SPACE_STEP_UNITS` 400, `MAX_SHEET_HEIGHT_UNITS`, `PROVISIONAL_TEXT_HEIGHT_UNITS`, `MAX_UPLOAD_MB` 25, `MAX_IMAGE_DIMENSION_PX`, `MAX_PDF_PAGES` 60, `STROKE_SIMPLIFY_TOLERANCE_UNITS` 0.75, `MAX_STROKE_POINTS`, `ERASER_RADIUS_UNITS` 8, `AWARENESS_THROTTLE_MS` 33, `PALM_REJECTION_WINDOW_MS`, `DEFAULT_PEN_COLOR_BY_ROLE`, `ALLOWED_UPLOAD_MIME_TYPES`, timeouts and persistence debounce |
| `ids.ts`              | Branded ids                          | `SessionId`, `SheetId`, `QuestionId`, `AssetId`, `UserId`, `StrokeId` (Zod `.brand()`), `newId()` (UUID v7), `asSessionId()` … validating casts                                                                                                                                                                                                                                                                                                                                             |
| `errors.ts`           | Error codes and class                | `APP_ERROR_CODES`, `AppError` (`code`, `details`, `cause`, `toResponse()`), `isAppError()`, `appErrorFromResponse()`, `ErrorResponseSchema`                                                                                                                                                                                                                                                                                                                                                 |
| `schemas/common.ts`   | Primitive formats                    | `IsoDateTimeSchema`, `HexColorSchema`, `TagSchema` (trim + lower-case), `BBoxSchema`, `OkResponseSchema`                                                                                                                                                                                                                                                                                                                                                                                    |
| `schemas/asset.ts`    | Asset DTO                            | `AssetSchema` (`id, mime, bytes, pageSizes[], sha256, url, thumbnailUrl, createdAt`), `PageSizeSchema`                                                                                                                                                                                                                                                                                                                                                                                      |
| `schemas/question.ts` | Question DTOs                        | `QUESTION_KINDS`, `QuestionSchema`, `CreateQuestionInputSchema` (discriminated: text vs media), `UpdateQuestionInputSchema`, `QuestionQuerySchema` (q, tags, kind, cursor, limit), `QuestionListSchema`                                                                                                                                                                                                                                                                                     |
| `schemas/sheet.ts`    | Sheet DTO and geometry               | `SheetGeometrySchema` `{ widthUnits: 1000, heightUnits, assetBox }`, `SheetSchema`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `schemas/stroke.ts`   | Stroke record                        | `TOOL_KINDS`, `POINT_STRIDE` 3, `StrokePointsSchema`, `StrokeRecordSchema`, `StrokeStyleSchema`                                                                                                                                                                                                                                                                                                                                                                                             |
| `schemas/session.ts`  | Users, sessions, participants        | `UserSchema`, `ListUsersQuerySchema`, `ParticipantSchema`, `SessionSchema`, `CreateSessionInputSchema`, `AddParticipantInputSchema`, `AssignQuestionsInputSchema`, `SessionQuestionSchema`, `OpenQuestionInputSchema`, `OpenQuestionResultSchema`, role/status enums                                                                                                                                                                                                                        |
| `schemas/auth.ts`     | Token and login DTOs                 | `HostTokenClaimsSchema` (`sub, name, role`), `LocalLoginInputSchema`, `MeSchema`, `LoginResponseSchema`                                                                                                                                                                                                                                                                                                                                                                                     |
| `schemas/realtime.ts` | Realtime naming and awareness        | `docName()`, `parseDocName()`, `SESSION_DOC_KEYS`, `SHEET_DOC_KEYS`, `LivePenSchema`, `AwarenessStateSchema`, `CONNECTION_STATUSES`                                                                                                                                                                                                                                                                                                                                                         |
| `api-contract.ts`     | Routes as data                       | `apiContract` (22 routes), `RouteInput<K>`, `RouteQuery<K>`, `RouteOutput<K>`, `isPublicRoute()`, `buildPath()`, `buildQueryString()`                                                                                                                                                                                                                                                                                                                                                       |
| `geometry.ts`         | Pure sheet geometry (used by server) | `pageHeightUnits()`, `computeSheetGeometry()`, `computeTextSheetGeometry()`, `extendSheetHeight()`, `withLiveHeight()`, `DEFAULT_MARGINS`                                                                                                                                                                                                                                                                                                                                                   |
| `permissions.ts`      | The permissions matrix as functions  | `canManageBank`, `canCreateQuestion`, `canBrowseBank`, `canAdministerSessions`, `canOpenQuestion`, `canEndSession`, `canViewSession`, `canWriteRealtime`, `canDraw`, `canEraseStroke`, `canControlSession`                                                                                                                                                                                                                                                                                  |

### 5.2 `@live-class/core` (`packages/core/src`)

Framework-free browser TypeScript. Everything with a lifetime has `dispose()`.

| File                               | Class / function                                                           | Does                                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events.ts`                        | `TypedEmitter<Events>`                                                     | Typed `on/once/emit/listenerCount/dispose`; listener errors isolated.                                                                                                                                                                     |
| `geometry/viewport.ts`             | `toSheetPoint()`, `toScreenPoint()`, `fitToWidthScale()`, `Viewport`       | Pixel ↔ sheet-unit conversion; `Viewport` lays the sheet out at 1000 px, CSS-scales it from the top-left, sizes the stage, observes container resize, exposes `state`, `sheetHeightUnits`, `currentScale`, `onChange`.                    |
| `ink/points.ts`                    | `simplifyPoints()`, `computeBBox()`, `distanceToSegment()`, …              | Flat `[x, y, pressure, …]` maths; iterative Ramer–Douglas–Peucker.                                                                                                                                                                        |
| `ink/stroke-builder.ts`            | `StrokeBuilder`                                                            | `begin/addPoint/end/cancel`; jitter filter, pressure clamp, point cap with escalating tolerance, bbox.                                                                                                                                    |
| `ink/stroke-renderer.ts`           | `StrokeRenderer`, `strokeOutline()`, `outlineToPath()`, `applyStyle()`     | perfect-freehand outlines → cached `Path2D` per committed stroke; `drawStroke/drawAll/drawLive`; highlighter at 35 % alpha.                                                                                                               |
| `ink/hit-test.ts`                  | `hitTestStroke()`, `findStrokesAt()`                                       | Eraser hit-testing (bbox reject, then segment distance incl. half width).                                                                                                                                                                 |
| `ink/pointer-policy.ts`            | `decidePointerAction()`, `cursorForTool()`                                 | Pen draws; mouse draws with the primary button; finger scrolls unless "draw with finger"; palm rejection window after pen input; read-only handling.                                                                                      |
| `ink/ink-layer.ts`                 | `InkLayer`                                                                 | Two canvases (committed + live) sized to device pixels within a memory guard; pointer handling with capture and coalesced events; emits `strokeCommitted`, `eraseRequested`, `livePenChanged`, `scrollRequested`; paints remote pens.     |
| `sync/realtime-client.ts`          | `RealtimeClient`, `ConnectedDoc`                                           | One `HocuspocusProviderWebsocket` shared by many `HocuspocusProvider`s (manual `attach`); status mapping; read-only scope detection; closes socket when the last doc closes.                                                              |
| `sync/sheet-doc.ts`                | `SheetDoc`                                                                 | `strokes` map + `meta.heightUnits`; `addStroke/removeStrokes/setHeightUnits/undo/redo`; validates records; per-user `Y.UndoManager`; `observe`, `onUndoStackChange`.                                                                      |
| `sync/session-doc.ts`              | `SessionDoc`                                                               | `sheetOrder` array + `meta.currentSheetId/studentCanWrite`; `appendSheets`, `setCurrentSheet`, `setStudentCanWrite`, `observe`.                                                                                                           |
| `sync/presence.ts`                 | `Presence`                                                                 | Awareness wrapper: `setLocal`, throttled `streamPen`, immediate `clearPen`, validated `getPeers`, `onChange`.                                                                                                                             |
| `question/question-view.ts`        | `QuestionView` interface, `QuestionViewFactory`                            | `mount(host) → PageSize`, optional `onScaleChange`, `dispose`.                                                                                                                                                                            |
| `question/image-view.ts`           | `ImageQuestionView`                                                        | `<img>` (also GIFs) sized from stored dimensions; optional bearer-token fetch via object URL.                                                                                                                                             |
| `question/text-view.ts`            | `TextQuestionView`                                                         | Renders sanitised Markdown+KaTeX at 1000 px and measures height.                                                                                                                                                                          |
| `question/markdown.ts`             | `renderMarkdownWithMath()` (async)                                         | Lazy-loads `markdown-renderer.ts` on first use (keeps ~130 kB out of the main bundle).                                                                                                                                                    |
| `question/markdown-renderer.ts`    | `renderMarkdownWithMathSync()`                                             | markdown-it + `@vscode/markdown-it-katex` (hardened: `trust:false`, `maxExpand`, `maxSize`) + DOMPurify allowlist (no links, images, scripts, handlers).                                                                                  |
| `question/pdf-page-view.ts`        | `PdfPageQuestionView`, `configurePdf()`                                    | Lazy `pdfjs-dist`, bearer-token fetch, renders the page at scale × DPR, re-renders on scale change; requires `configurePdf({ workerSrc })`.                                                                                               |
| `question/create-question-view.ts` | `createQuestionView()`                                                     | Kind → view factory.                                                                                                                                                                                                                      |
| `sheet/sheet-controller.ts`        | `SheetController`                                                          | Builds stage → sheet → content host DOM, composes Viewport + QuestionView + InkLayer + SheetDoc + Presence, applies permissions (`canDraw`, `canEraseStroke`, `canControlSession`), `addSpace`, `undo/redo`, events `ready/error/change`. |
| `api/client.ts`                    | `LiveClassApi`                                                             | `call(routeName, { params, body, query, signal })` from the contract with validation; `uploadAsset()` (XHR with progress, fetch fallback); `urlFor`, `assetFileUrl`, `assetThumbnailUrl`; timeouts → `TIMEOUT`, failures → `NETWORK`.     |
| `room/room-store.ts`               | `RoomStore`, `RealtimeConnection`, `RoomSnapshot`                          | Observable room: loads session/sheets/questions, opens `session:<id>`, presence, follow mode, `viewSheet`, `setFollowMentor`, `setCurrentSheet`, `setStudentCanWrite`, `refresh`, stable snapshots for `useSyncExternalStore`.            |
| `test/fake-realtime.ts`            | `FakeRealtimeHub`, `FakeRealtime` (exported as `@live-class/core/testing`) | In-memory realtime: per-client replicas synced through a hub, distinct awareness ids; used by core and React tests.                                                                                                                       |

### 5.3 `@live-class/react` (`packages/react/src`)

All components are client components; styles ship in `styles.css` (prefix `lc-`, CSS
variables for theming, dark mode via `prefers-color-scheme`; imports KaTeX CSS).

| File                            | Export                                                       | Does                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context.tsx`                   | `LiveClassProvider`, `useLiveClass`, `RealtimeLike`          | Builds `LiveClassApi` + `RealtimeClient` once, resolves `GET /me`, provides `{ api, realtime, user, getToken, reportError }`; test seams `api`/`realtime` props.                                                                                                              |
| `host-bridge.ts`                | `HostBridge`, `TokenSource`                                  | Holds the host's latest token source and error handler behind stable methods (updated from an effect).                                                                                                                                                                        |
| `hooks/useRoom.ts`              | `useRoom(sessionId)` → `{ snapshot, store }`                 | One `RoomStore` per session, `useSyncExternalStore` subscription, start/dispose with the component.                                                                                                                                                                           |
| `hooks/useAsync.ts`             | `useAsync(loader, key)`                                      | Keyed async state with reload; stale results ignored; previous data kept while loading.                                                                                                                                                                                       |
| `components/LiveClassRoom.tsx`  | `LiveClassRoom`                                              | Header + `PresenceBar`, `Toolbar`, `SheetTabs`, `SheetStage`, and `QuestionPicker` for mentors/admins; locks drawing when read-only, ended, or student writing is off.                                                                                                        |
| `components/SheetStage.tsx`     | `SheetStage`, `SheetHistoryState`                            | Opens `sheet:<id>` keyed by **ids** (a refetched sheet object never remounts the connection), mounts `SheetController`, forwards tool/style/permissions, exposes `data-stroke-count`, `data-synced` and `data-connection` for tests, reports undo state via `useEffectEvent`. |
| `components/Toolbar.tsx`        | `Toolbar`, `PALETTE`                                         | Tools, colours, width, undo/redo, finger drawing; mentor: add space, student-can-write, end session; student: follow mentor. All controls ≥ 44 px, labelled.                                                                                                                  |
| `components/SheetTabs.tsx`      | `SheetTabs`                                                  | Ordered tabs with question titles, page suffix, "mentor is here" marker.                                                                                                                                                                                                      |
| `components/PresenceBar.tsx`    | `PresenceBar`                                                | Connection badge + participants with roles written out.                                                                                                                                                                                                                       |
| `components/QuestionPicker.tsx` | `QuestionPicker`                                             | Planned questions, bank search, ad hoc upload → `openQuestion`.                                                                                                                                                                                                               |
| `components/QuestionBank.tsx`   | `QuestionBank`                                               | Search/filter, add (file or Markdown), edit metadata, delete; `onSelect` + `readOnly` for embedding.                                                                                                                                                                          |
| `components/SessionSetup.tsx`   | `SessionSetup`                                               | Create session, add mentor/student, pre-assign from the bank, link to the room.                                                                                                                                                                                               |
| `components/ErrorBoundary.tsx`  | `ErrorBoundary`                                              | Catches render errors; retry button; reports to the host.                                                                                                                                                                                                                     |
| `forms.ts`, `errors.ts`         | `field`, `tagField`, `fileField`, `FormSubmit`, `toAppError` | Form helpers and error normalisation.                                                                                                                                                                                                                                         |
| `index.ts`                      | re-exports above + `configurePdf`, `LiveClassApi` from core  |                                                                                                                                                                                                                                                                               |

### 5.4 `@live-class/server` (`packages/server/src`)

| File                                        | Owns                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.ts`                                 | `loadConfig(env)` — Zod schema over the environment (§12), cross-field rules, readable failure; `testConfig()` for tests.                                                                                                                                                                              |
| `logger.ts`                                 | `createLogger()` — pino with redaction of tokens/passwords; optional pretty transport.                                                                                                                                                                                                                 |
| `metrics.ts`                                | `createMetrics()` — Prometheus registry: HTTP latency histogram, failed uploads counter, realtime connection/document gauges.                                                                                                                                                                          |
| `db/schema.ts`                              | Drizzle tables (§6).                                                                                                                                                                                                                                                                                   |
| `db/client.ts`                              | `createDatabase(url)` → `{ db, driver, migrate, ping, close }` for `pglite://memory`, `pglite://<dir>` or `postgres://…`; `Db` type.                                                                                                                                                                   |
| `db/migrate-cli.ts`, `db/drizzle.config.ts` | `pnpm db:migrate`, `pnpm db:generate`; migrations in `packages/server/drizzle/`.                                                                                                                                                                                                                       |
| `storage/*`                                 | `StorageAdapter` interface; `LocalStorageAdapter` (path-traversal safe); `S3StorageAdapter` (Supabase/R2/S3/MinIO); `createStorage(config)`.                                                                                                                                                           |
| `auth/tokens.ts`                            | `TokenService.verify()` (host JWT via JWKS or shared secret with issuer/audience checks → upsert by `host_user_id`; local HS256 tokens), `issueLocalToken()`.                                                                                                                                          |
| `auth/password.ts`                          | bcrypt `hashPassword`/`verifyPassword` (dev login only).                                                                                                                                                                                                                                               |
| `authz/policies.ts`                         | `assertRole`, `bankPolicy`, `SessionPolicy` (`assertView` hides non-member sessions as `NOT_FOUND`; `assertOpenQuestion`, `assertEnd`, `assertAdminister`).                                                                                                                                            |
| `plugins/errors.ts`                         | `toAppError()` (Zod, Fastify multipart/body/rate-limit errors → codes), `statusFor()`, error + not-found handlers.                                                                                                                                                                                     |
| `plugins/auth.ts`                           | `request.user`, `app.authenticate` pre-handler, `requireUser()`, `bearerToken()`.                                                                                                                                                                                                                      |
| `plugins/security.ts`                       | Helmet (cross-origin resources allowed), CORS allowlist, rate limit (300/min; login 10/min; uploads 30/min).                                                                                                                                                                                           |
| `services/asset-validation.ts`              | `validateUpload()` — size, content sniffing allowlist, image dimensions (sharp), PDF pages/sizes (pdf-lib), rejects encrypted PDFs and active content (`hasActiveContent`: JS, Launch, EmbeddedFile(s), RichMedia, XFA, GoToR, …).                                                                     |
| `services/asset-service.ts`                 | `AssetService` — `createFromUpload` (validate → dedupe by sha256 → store → thumbnail), `openFile`, `openThumbnail`.                                                                                                                                                                                    |
| `services/question-service.ts`              | `QuestionService` — `create` (kind/MIME agreement), `get`, `getMany`, `list` (ILIKE + tag containment + keyset cursor), `update`, `softDelete`.                                                                                                                                                        |
| `services/session-service.ts`               | `SessionService` — `create`, `get`, `list`, `addParticipant` (one per role, role must match account), `membership`, `assignQuestions`, `listQuestions`, `openQuestion` (transactional sheet creation, `scheduled → live`), `listSheets`, `getSheet`, `participantCanSeeAsset`, `end`; `geometryFor()`. |
| `services/user-service.ts`                  | `UserService` — `authenticateLocal`, `list`, `get`, `delete` (privacy scrub), `seedIfEmpty`; `SEED_USERS`; `escapeLike()`.                                                                                                                                                                             |
| `services/mappers.ts`, `container.ts`       | Row → DTO mapping; `Services` type.                                                                                                                                                                                                                                                                    |
| `routes/*.routes.ts`                        | Handlers registered from `apiContract` paths (§8); a test asserts every contract route exists.                                                                                                                                                                                                         |
| `realtime/hocuspocus.ts`                    | `createRealtime()` — Hocuspocus with Database extension (`yjs_documents`), optional Redis; `authorizeDocument()` implements §11 for `onAuthenticate` (read-only for admins and ended sessions).                                                                                                        |
| `realtime/websocket-route.ts`               | `GET /realtime` via `@fastify/websocket` → `hocuspocus.handleConnection(ws, Request)` with external `handleMessage`/`handleClose` dispatch (Hocuspocus v4 transport-agnostic API).                                                                                                                     |
| `realtime/server-doc-ops.ts`                | `appendSheetsToSession()` — server-side edit of the session document through a direct connection.                                                                                                                                                                                                      |
| `app.ts`, `index.ts`                        | `buildServer(config)` assembly (migrate on start, seed dev users, plugins, routes, realtime, graceful `onClose` flush); process entry with SIGTERM/SIGINT handling.                                                                                                                                    |
| `test/helpers.ts`                           | `startTestServer()`, multipart encoder, PNG/JPEG/GIF/PDF fixture generators (sharp, pdf-lib).                                                                                                                                                                                                          |

### 5.5 `apps/demo` (static Next.js 16 export)

Pages: `/` (instructions), `/login/` (dev login → token in `sessionStorage`), `/admin/`
(`SessionSetup` + `QuestionBank`), `/room/?session=<id>` (`LiveClassRoom`). `AppProvider`
wraps pages in `LiveClassProvider` and redirects to login when no token is stored;
`scripts/copy-pdf-worker.mjs` copies the pdf.js worker into `public/` before build.

### 5.6 `e2e` (Playwright)

`playwright.config.ts` starts `node packages/server/dist/index.js` (embedded DB, local
storage, seeded accounts) and `serve apps/demo/out`. Suites: `live-sync.spec.ts` (mentor
opens a question, mouse-drawn stroke reaches the student, undo propagates; write lock) and
`admin.spec.ts` (create session, add participants, add a text question).

## 6. Data model (PostgreSQL / PGlite) — `packages/server/src/db/schema.ts`

Ids are UUID v7 text. Timestamps are `timestamptz`.

| Table                  | Columns                                                                                                                                                   | Notes                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `users`                | `id`, `host_user_id` (unique, null), `display_name`, `role`, `email` (unique, null), `password_hash` (null), `created_at`, `deleted_at`                   | Email/password only for the dev login. Deletion scrubs personal fields.     |
| `sessions`             | `id`, `title`, `status`, `scheduled_at`, `started_at`, `ended_at`, `created_by`, `created_at`                                                             |                                                                             |
| `session_participants` | `session_id`, `user_id`, `role`, `joined_at`; PK (session, user); unique (session, role)                                                                  | Exactly one mentor and one student.                                         |
| `assets`               | `id`, `storage_key` (unique), `mime`, `bytes`, `sha256` (unique), `page_sizes` jsonb, `thumbnail_key`, `created_by`, `created_at`                         | Immutable.                                                                  |
| `questions`            | `id`, `kind`, `title`, `alt_text`, `tags` text[] (GIN), `text_markdown`, `asset_id`, `page_count`, `created_by`, `created_at`, `updated_at`, `deleted_at` | CHECK: text ⇔ markdown set and no asset; media ⇔ asset set and no markdown. |
| `session_questions`    | `session_id`, `question_id`, `position`, `source` (`preassigned`/`live`/`adhoc`), `opened_at`; PK (session, question)                                     |                                                                             |
| `sheets`               | `id`, `session_id`, `question_id`, `page_index`, `position`, `geometry` jsonb, `created_at`                                                               | One per page opened.                                                        |
| `yjs_documents`        | `name` PK (`session:<id>` / `sheet:<id>`), `state` bytea, `updated_at`                                                                                    | Hocuspocus persistence.                                                     |
| `session_settings`     | `session_id` PK, `student_can_write`                                                                                                                      | Reserved (not written yet); the live flag lives in the session document.    |

Migration: `packages/server/drizzle/0000_aromatic_junta.sql` (generated by drizzle-kit).

## 7. Realtime documents (Yjs over Hocuspocus 4)

| Document              | Structure                                                                           | Who writes                                                            |
| --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `session:<sessionId>` | `meta: Y.Map` → `currentSheetId`, `studentCanWrite`; `sheetOrder: Y.Array<SheetId>` | Server (append sheets on open), mentor (current sheet, write toggle). |
| `sheet:<sheetId>`     | `strokes: Y.Map<StrokeId, StrokeRecord>`; `meta: Y.Map` → `heightUnits`             | Mentor and student (strokes), mentor (height).                        |

Awareness state (`AwarenessStateSchema`): `{ user: { id, name, role, color }, viewingSheetId,
followMentor, pen: { sheetId, style, points } | null }`. In-progress strokes travel only in
`pen` (throttled 30 Hz; cleared immediately on pen-up).

Server side: `onAuthenticate` verifies the token, resolves the session (via the sheet for
sheet documents), checks `canViewSession`, sets `readOnly = !canWriteRealtime(role, status)`.
Persistence debounce 2 s / max 10 s; `app.close()` closes sockets and flushes pending stores.
Redis fan-out is wired (`REDIS_URL`) but not exercised by tests.

## 8. HTTP API (`packages/shared/src/api-contract.ts`)

JSON unless noted; bearer token unless public. Errors: `{ code, message, details? }`.

| Method & path                                   | Who                        | Purpose                                                          |
| ----------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `POST /auth/local/login`                        | public (dev/demo only)     | Email/password → token + user. 10/min.                           |
| `GET /me`                                       | any                        | Current user.                                                    |
| `GET /users?role&q`                             | admin                      | List users (to pick participants).                               |
| `DELETE /users/:id`                             | admin                      | Privacy deletion.                                                |
| `GET /questions?q&tags&kind&cursor&limit`       | admin, mentor              | Search the bank (keyset pagination).                             |
| `POST /questions`                               | admin, mentor              | Create from `assetId` or `textMarkdown`.                         |
| `GET /questions/:id`                            | admin, mentor              | One question.                                                    |
| `PATCH /questions/:id`                          | admin                      | Edit title/alt text/tags.                                        |
| `DELETE /questions/:id`                         | admin                      | Soft delete.                                                     |
| `POST /assets` (multipart `file`)               | admin, mentor              | Upload → validated asset (201). 30/min.                          |
| `GET /assets/:id/file`                          | admin, mentor, participant | Stream (students only for assets used in their sessions).        |
| `GET /assets/:id/thumbnail`                     | same                       | PNG thumbnail (raster assets only).                              |
| `POST /sessions`                                | admin                      | Create.                                                          |
| `GET /sessions`                                 | any                        | Admin: all; others: own.                                         |
| `GET /sessions/:id`                             | participant, admin         | With participants.                                               |
| `POST /sessions/:id/participants`               | admin                      | Add mentor or student.                                           |
| `POST /sessions/:id/questions`                  | admin                      | Pre-assign.                                                      |
| `GET /sessions/:id/questions`                   | participant, admin         | Attached questions with `openedAt`.                              |
| `GET /sessions/:id/questions/:questionId`       | participant, admin         | A question attached to the session (students can read it).       |
| `POST /sessions/:id/questions/:questionId/open` | mentor, admin              | Create sheets, mark opened, update the session document (201).   |
| `GET /sessions/:id/sheets`                      | participant, admin         | Sheets in order.                                                 |
| `POST /sessions/:id/end`                        | mentor, admin              | End.                                                             |
| `GET /healthz`, `GET /readyz`, `GET /metrics`   | public                     | Liveness; readiness (db + storage); Prometheus.                  |
| `WS /realtime`                                  | participant                | Hocuspocus endpoint (token sent in the protocol's auth message). |

## 9. Coordinate system and rendering

- **Sheet units:** width is always 1000. Height = `marginTop + assetHeight + marginBottom`
  where `assetHeight = 1000 × intrinsicH / intrinsicW` (raster/PDF) or the measured text
  height. "Add space" grows `marginBottom` by 400 (stored as `meta.heightUnits`).
- **Scaling:** `scale = containerWidth / 1000`; DOM content is laid out at 1000 CSS px and
  CSS-scaled from the top-left; canvases are sized to displayed pixels × DPR (bounded by an
  8 M-pixel guard) and drawn with `ctx.setTransform(k, 0, 0, k, 0, 0)`.
- **Strokes:** flat `[x, y, pressure, …]` in sheet units, simplified at 0.75 units;
  eraser radius 8 units, whole-stroke deletion; per-user undo.
- **Why fixed width:** invariant 1 — ink stays on the same part of the question on every device.

## 10. Question kinds

| Kind    | Upload / validation                                                              | Render                                                                            | Page size               |
| ------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------- |
| `image` | PNG/JPEG by content; 16–8000 px sides                                            | `<img>`                                                                           | stored width/height     |
| `gif`   | GIF by content, bytes kept verbatim (animation preserved); first-frame thumbnail | `<img>` (loops)                                                                   | stored width/height     |
| `pdf`   | PDF by content; ≤ 60 pages; encrypted or active-content PDFs rejected            | pdf.js canvas per page, lazy-loaded; worker from the host's origin                | stored per-page sizes   |
| `text`  | Markdown ≤ 20 000 chars                                                          | markdown-it + KaTeX (hardened) + DOMPurify, lazy-loaded; bundled serif font stack | measured in the browser |

Known risk for `text`: small height differences across browsers; mitigated by fixed font size
and line height, and `withLiveHeight` never cutting content off.

## 11. Permissions matrix (implemented in `shared/permissions.ts`, enforced server-side in `authz/` and `realtime/`)

| Action                                   | Admin          | Mentor           | Student                         |
| ---------------------------------------- | -------------- | ---------------- | ------------------------------- |
| Manage bank (edit/delete)                | ✔              | ✖                | ✖                               |
| Create questions / upload                | ✔              | ✔                | ✖                               |
| Browse bank                              | ✔              | ✔                | ✖ (sees session questions only) |
| Create session, add participants, assign | ✔              | ✖                | ✖                               |
| Open question in session                 | ✔              | ✔ (own sessions) | ✖                               |
| Set current sheet / student write toggle | (observer: no) | ✔                | ✖                               |
| Draw                                     | ✖ (read-only)  | ✔                | ✔ when `studentCanWrite`        |
| Erase                                    | ✖              | any stroke       | own strokes                     |
| Add space                                | ✖              | ✔                | ✖                               |
| End session                              | ✔              | ✔                | ✖                               |
| Read ended session                       | ✔              | ✔ (own)          | ✔ (own)                         |

Per-stroke rules (erase own only) are client-side because Yjs updates are opaque to the
server; document-level access and read-only scope are server-side.

## 12. Configuration (`packages/server/src/config.ts`, documented in `.env.example`)

| Variable                                                                                                                                          | Required                              | Meaning                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                                                        | no (`development`)                    | `development` · `test` · `demo` (JSON logs, local login allowed) · `production` (local login forbidden) |
| `PORT`, `HOST`, `TRUST_PROXY`                                                                                                                     | no                                    | Listen settings; trust proxy headers behind a PaaS.                                                     |
| `CORS_ORIGINS`                                                                                                                                    | yes                                   | Comma-separated browser origins.                                                                        |
| `DATABASE_URL`                                                                                                                                    | yes                                   | `pglite://memory`, `pglite://./.data/dev`, or `postgres://…`.                                           |
| `DB_MIGRATE_ON_START`                                                                                                                             | no (`true`)                           | Apply migrations at boot.                                                                               |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | driver-dependent                      | Local disk (dev) or any S3-compatible store.                                                            |
| `AUTH_HOST_JWKS_URL` or `AUTH_HOST_SHARED_SECRET`, `AUTH_HOST_ISSUER`, `AUTH_HOST_AUDIENCE`                                                       | one of the first two (or local login) | Host token verification.                                                                                |
| `AUTH_LOCAL_ENABLED`, `AUTH_LOCAL_JWT_SECRET`, `AUTH_LOCAL_SEED_PASSWORD`, `AUTH_LOCAL_TOKEN_TTL_SECONDS`                                         | when local login is on                | Dev/demo login and seeded accounts.                                                                     |
| `REDIS_URL`                                                                                                                                       | no                                    | Multi-instance realtime fan-out.                                                                        |
| `MAX_UPLOAD_MB`, `RATE_LIMIT_LOGIN_PER_MINUTE`, `LOG_LEVEL`, `LOG_PRETTY`                                                                         | no                                    | Limits (upload size; login attempts per minute, raised only for automated tests) and logging.           |

Client (host) configuration is props: `apiBaseUrl`, `realtimeUrl`, `token`. The demo bakes
`NEXT_PUBLIC_LIVE_CLASS_API` and `NEXT_PUBLIC_LIVE_CLASS_WS` into its static build.

## 13. Host integration contract (Next.js)

```tsx
'use client';
import { configurePdf, LiveClassProvider, LiveClassRoom } from '@live-class/react';
import '@live-class/react/styles.css'; // includes KaTeX CSS

configurePdf({ workerSrc: '/pdf.worker.min.mjs' }); // copy pdfjs-dist/build/pdf.worker.min.mjs to public/

export default function ClassPage({ sessionId, token }: { sessionId: string; token: string }) {
  return (
    <LiveClassProvider
      apiBaseUrl={process.env.NEXT_PUBLIC_LIVE_CLASS_API!}
      realtimeUrl={process.env.NEXT_PUBLIC_LIVE_CLASS_WS!}
      token={token} // or () => Promise<string> to refresh
      onError={(e) => report(e)}
    >
      <LiveClassRoom sessionId={sessionId as never} />
    </LiveClassProvider>
  );
}
```

- **Token:** the host backend signs a JWT (HS256 shared secret or its JWKS) with `sub`
  (host user id), `name`, `role` (`admin|mentor|student`), `iss = AUTH_HOST_ISSUER`,
  `aud = AUTH_HOST_AUDIENCE`, short `exp`. The server upserts the user by `host_user_id`.
- **Admin screens:** `<SessionSetup roomHref={(id) => …} />` and `<QuestionBank />` inside
  the same provider. Sessions can also be created server-to-server with an admin token.
- **Isolation:** no cookies, globals or router use; all styles prefixed `lc-`; components are
  client-only and SSR-safe; errors flow to `onError`.
- **Dependencies the host needs:** React 19; `pdfjs-dist` worker file served from its origin.

## 14. How to run, test and deploy

### 14.1 Local development (no installs beyond Node 24 and pnpm)

```bash
pnpm install
cp .env.example .env     # DATABASE_URL=pglite://./.data/dev, STORAGE_DRIVER=local, local login on
pnpm build               # shared, core, react → dist
pnpm dev                 # server :4000 (tsx watch) + demo :3000 (next dev)
```

Seeded accounts (password `password123`): `admin@local.test`, `mentor@local.test`,
`student@local.test`.

Checks: `pnpm check` (typecheck, lint, format, unit tests), `pnpm test:coverage`,
`pnpm size`, `pnpm test:e2e` (needs `pnpm --filter @live-class/server build` and
`pnpm --filter @live-class/demo build` first; `pnpm exec playwright install chromium` once).

### 14.2 Deployment tiers

The code is identical in every tier; only environment variables and hosting plans change.

| Concern                                   | Tier 0 — free demo (now)                                                                                     | Tier 1 — paid scale (later)                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Server (API + realtime, one process)      | Render free web service (Docker, 512 MB, sleeps after 15 min idle, 30–60 s wake; stays awake during a class) | Render Starter / VPS / Fly / Railway; 2+ instances + Redis |
| Postgres                                  | Supabase free (500 MB; pauses after 7 idle days, one-click restore)                                          | Supabase Pro or Neon with pooler                           |
| File storage                              | Supabase Storage free (1 GB) via S3-compatible endpoint, `STORAGE_DRIVER=s3`                                 | Cloudflare R2 or S3 (same adapter)                         |
| Redis                                     | not set                                                                                                      | `REDIS_URL` set                                            |
| Demo frontend (`apps/demo` static export) | Render static site (free, never sleeps)                                                                      | The owner's Next.js host app                               |

Verified 2026-10-06: Render and Supabase free tiers need no card; without a payment method
overages suspend rather than bill. Vercel Hobby is excluded (commercial use forbidden).
Fallbacks if Render asks for card verification: Railway free plan, SnapDeploy, Hugging Face
Docker Spaces — the image is standard Docker, so nothing changes in the code.

### 14.3 Free demo deployment — 🔵 In progress (repo on GitHub; Supabase/Render not created yet)

The repository is `github.com/rahul-sijwali/live_class` (private). CI on the first push:
unit tests, lint, size budget and **Docker image build pass**; e2e passes after the script fix.

1. **Supabase** (supabase.com, sign in with GitHub, no card): New project → region
   **Southeast Asia (Singapore)** → save the database password.
   - _Connect_ → **Session pooler** URI (port 5432, IPv4) → replace `[YOUR-PASSWORD]` and append
     `?sslmode=no-verify` → this is `DATABASE_URL`. (The direct `db.<ref>.supabase.co` host is
     IPv6-only and Render cannot reach it; `no-verify` because Supabase signs with its own CA.)
   - _Storage_ → New bucket `live-class`, **private**.
   - _Storage → Settings → S3 Connection_: copy the **Endpoint** (`S3_ENDPOINT`) and **Region**
     (`S3_REGION`); _New access key_ → `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
2. **Render** (render.com, sign in with GitHub, no card): _New → Blueprint_ → pick the repo →
   it reads `render.yaml` and creates `live-class-server` (free, Singapore) and
   `live-class-demo` (static). Fill the prompted values:
   - server: `CORS_ORIGINS=https://live-class-demo.onrender.com`, `DATABASE_URL`, the four `S3_*`,
     `AUTH_LOCAL_SEED_PASSWORD` (any password; used by the three seeded accounts);
   - demo: `NEXT_PUBLIC_LIVE_CLASS_API=https://live-class-server.onrender.com`,
     `NEXT_PUBLIC_LIVE_CLASS_WS=wss://live-class-server.onrender.com/realtime`.
3. When both deploys finish, compare the real addresses on each service page with the guesses
   above. If Render added a suffix, correct the values, then _Manual Deploy → Deploy latest
   commit_ on the **demo** (its values are baked in at build time).
4. Check `https://live-class-server.onrender.com/readyz` → `{"ok":true,"database":true,"storage":true}`.
5. Never add a payment method to either account while on the free tiers.

### 14.4 Switching hosting providers

Everything provider-specific is outside the code: `render.yaml` (optional), environment
variables, and the Docker image. To move: build the image anywhere (`docker build -t
live-class-server .`), run it with the variables from §12, point `CORS_ORIGINS` at the
frontend, host `apps/demo/out` on any static host, and set the two `NEXT_PUBLIC_*` values.
`docker-compose.yml` shows a complete single-VPS setup with Postgres and MinIO.

## 15. Decision log

| #     | Decision                                                                                                                                                                                               | Why                                                                                                                                                   | Alternatives                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| D-001 | TypeScript monorepo with pnpm workspaces                                                                                                                                                               | One language, shared schemas, strict typing                                                                                                           | Separate repos                                          |
| D-002 | Framework-free `core` + thin React wrapper                                                                                                                                                             | Host is React/Next.js today; core stays portable and testable                                                                                         | React-only; Web Component only                          |
| D-003 | Yjs via Hocuspocus 4 for live sync                                                                                                                                                                     | CRDT merging, offline tolerance, auth hook, DB persistence, Redis extension                                                                           | raw y-websocket, custom OT, Liveblocks                  |
| D-004 | Fixed logical sheet width (1000), scale as a whole                                                                                                                                                     | Only robust way to keep ink aligned across devices                                                                                                    | Responsive reflow                                       |
| D-005 | In-progress strokes over awareness; commit on pointer-up                                                                                                                                               | Keeps the shared document small                                                                                                                       | Streaming points into the doc                           |
| D-006 | Canvas 2D, two layers (committed + live)                                                                                                                                                               | Performance with thousands of strokes                                                                                                                 | SVG, WebGL                                              |
| D-007 | Whole-stroke eraser                                                                                                                                                                                    | Simple, predictable, trivially syncable                                                                                                               | Pixel eraser                                            |
| D-008 | Server-proxied multipart upload with content sniffing                                                                                                                                                  | Validation before storage; works with local disk in dev; fine on Render                                                                               | Presigned uploads (needed only on function-based hosts) |
| D-009 | Fastify 5 + Drizzle + Postgres, **PGlite for dev/tests**                                                                                                                                               | Fast, typed; embedded Postgres removes every local install and makes API tests real                                                                   | Express, Prisma, Docker Postgres for tests              |
| D-010 | No video in this codebase                                                                                                                                                                              | Zoom is cheaper for 1:1 at this scale                                                                                                                 | LiveKit, Zoom Video SDK                                 |
| D-011 | pdf.js renders PDF pages in the browser; host serves the worker                                                                                                                                        | No server rendering cost; crisp at any scale                                                                                                          | Server rasterisation                                    |
| D-012 | Text questions rendered client-side with a fixed font stack                                                                                                                                            | Crisp, selectable, searchable; height measured and never cut off                                                                                      | Server-side SVG                                         |
| D-013 | UUID v7 ids                                                                                                                                                                                            | Time-sortable, no sequence leakage                                                                                                                    | Serial ints                                             |
| D-014 | Host-issued JWT; local login only outside production (`demo` mode allowed)                                                                                                                             | Host owns identity; the public demo still needs a login                                                                                               | Full auth system                                        |
| D-015 | Zero-cost demo on no-card free tiers (Render + Supabase), scale by config only                                                                                                                         | Owner constraint; providers suspend rather than bill without a card                                                                                   | Vercel Hobby (no commercial use), card-requiring clouds |
| D-016 | `apps/demo` is a static Next.js export using `/room/?session=<id>`                                                                                                                                     | Free static hosting that never sleeps; proves the package is client-only                                                                              | Server-rendered demo                                    |
| D-017 | KaTeX/markdown-it and pdf.js are lazy-loaded chunks                                                                                                                                                    | Keeps the main bundle at ~63 kB brotli; only text/PDF questions pay                                                                                   | Eager bundling (+130 kB)                                |
| D-018 | Room orchestration lives in `RoomStore` (core), React subscribes via `useSyncExternalStore`                                                                                                            | Testable without React; satisfies React 19 rules (no refs in render, no setState in effects)                                                          | Logic inside hooks                                      |
| D-019 | Lint enforces documentation (`eslint-plugin-jsdoc` TS flavour) and React 19 rules (`@eslint-react`, `react-hooks`)                                                                                     | Standards that are not checked drift; `eslint-plugin-react` is incompatible with ESLint 10                                                            | Review-only enforcement                                 |
| D-020 | Coverage gates: 80 % statements/lines, 78 % functions, 68 % branches overall; critical modules 90–95 % statements/lines                                                                                | Honest, enforced numbers beat aspirational ones; branch coverage on defensive code is a poor target                                                   | 95 % everywhere (never met)                             |
| D-021 | A sheet connection is never closed and reopened for the same id (id-based effect deps in `SheetStage`, structural sharing of `sheets` in `RoomStore`); Hocuspocus runs with `unloadImmediately: false` | Found by e2e: an instant reconnect raced the server's document unload and put the two clients on different document instances, so ink stopped syncing | Server-side change only (library behaviour)             |

## 16. Known limitations and open questions

- Per-stroke permissions (students erase only their own) are enforced client-side only.
- Animated GIFs cannot be paused; both sides see them loop independently.
- Text-question height may differ slightly across browsers (never cuts content off).
- v1 has no pinch-zoom (fit-to-width + vertical scroll), no stroke replay, no scroll sync.
- Zod (classic) is ~75 kB brotli of the core bundle before tree-shaking; `zod/mini` would
  save most of it if bundle size ever matters more.
- Redis fan-out is wired but untested; single instance is the supported configuration today.
- Hocuspocus unloads a document when its last connection closes. D-021 stops clients from reconnecting instantly and delays unload until the pending store runs; a client that drops and returns within milliseconds on a document with no pending changes could still race the unload. Not observed after the fix (9/9 e2e runs).
- Hocuspocus unloads a document when its last connection closes; D-021 keeps clients from
  reconnecting instantly and delays unload until the pending store runs, but a client that
  drops and returns within milliseconds on a document with no pending changes could still
  race the unload. Not observed after the fix (9/9 e2e runs).
- The Docker image has not been built on this machine (no Docker); CI builds it.
- Open: should ad hoc mentor uploads join the bank (today they do, tagged `adhoc`)?
- Open: folders/collections beyond tags?
- Open: should the mentor's scroll position be shared (follow scroll, not just sheet)?

## 17. Changelog of this document

| Date       | Change                                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-06 | Initial architecture written before any code.                                                                                                                                                                                                                                                         |
| 2026-10-06 | Added zero-cost deployment constraint, deployment tiers, D-015/D-016, provider verification.                                                                                                                                                                                                          |
| 2026-10-07 | Everything implemented: statuses → 🟢 with file paths; added `RoomStore`, `getSessionQuestion` route, `demo` NODE_ENV, Docker/Render/compose artefacts, e2e suites, D-017–D-020, coverage and bundle figures, switching-providers section.                                                            |
| 2026-10-07 | Sync-stability fix (D-021), `RATE_LIMIT_LOGIN_PER_MINUTE`, stage diagnostic attributes; e2e sign-in via API token with one form-based test.                                                                                                                                                           |
| 2026-10-07 | Deployment prep: Render server in Singapore, Supabase session-pooler URL with `sslmode=no-verify`, removed the static-site rewrite rule, `NODE_VERSION=24` for the static build, root `test:e2e` points at its config; §14.3 rewritten as a click-by-click guide; Docker image build confirmed in CI. |
| 2026-10-07 | Render static build: removed `npm install -g pnpm` (Render supplies pnpm from `packageManager`; its global npm folder is read-only, which failed the first demo deploy).                                                                                                                              |
