# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is `pnpm` (see `packageManager` field in `package.json`).

- `pnpm dev` — Vite dev server on port 3000 (`--host` so it's reachable on the LAN / Manus preview). The dev server also injects a debug-log collector plugin that POSTs browser console/network/session events to `.manus-logs/*.log`.
- `pnpm build` — two-step: Vite builds the SPA to `dist/public/`, then esbuild bundles `server/index.ts` to `dist/index.js` (ESM, Node, external deps).
- `pnpm start` — runs the production Express server (`NODE_ENV=production node dist/index.js`). The server is a thin static+SPA-fallback host; it does not expose an API.
- `pnpm check` — `tsc --noEmit` type check (the canonical "did I break it" gate; there is no test suite even though `vitest` is in devDeps).
- `pnpm format` — Prettier write across the repo.

Vercel deploys run `pnpm vite build` only and publish `dist/public/` (see `vercel.json`); the Express server is not used in the Vercel deployment.

## Required env vars

The app works without any env vars (falls back to in-browser "demo mode"), but hosted sync needs:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
- `VITE_ANALYTICS_ENDPOINT` + `VITE_ANALYTICS_WEBSITE_ID` — optional Umami; `client/index.html` has an inline loader that only attaches the umami `<script>` when Vite actually substituted the placeholders, so missing values silently no-op.

## Architecture

### Three runtime modes, one store

`client/src/hooks/useHeroApp.ts` (~1200 lines) owns React state, auth bootstrap, derived memos (upcomingItems, doneItems, streak, etc.), and the undo stack. It does *not* speak to Supabase directly. CRUD goes through a `HeroStore` held in a ref — one of three implementations — chosen once per session:

| Condition | Mode | `storeRef.current` | Storage |
| --- | --- | --- | --- |
| no env vars | demo | `createLocalStore(userId)` | `localStorage` keyed by `demo-user` |
| auth works but the first-ever `loadSnapshot()` (no local cache) throws `SchemaMissingError` (PostgREST `42P01`) | local fallback | `createLocalStore(userId)` | `localStorage` keyed by real user id, UI surfaces "database tables are not ready yet" banner |
| auth works | live | `createSyncedStore(userId, createRemoteStore(userId, getAccessToken))` | local-first: `localStorage` snapshot + outbox, synced to Supabase `projects` + `items` in the background |

All stores implement the same interface (`loadSnapshot`, `insertProject`, `updateProject`, `insertItem`, `updateItem`, `deleteItem`) defined in `client/src/lib/heroStore.types.ts`. Each mutation in `useHeroApp.ts` is a thin wrapper: `try { const row = await storeRef.current.method(...); setState(row); return { ok: true } } catch (e) { return { ok: false, message: e.message } }` — no per-mutation mode branching. Snapshots persisted to `localStorage` are re-normalized on load (`normalizeSnapshotIds`) because remote tables require UUID ids but legacy local snapshots may contain non-UUID ids.

Live mode is local-first. `heroStore.synced.ts` applies every mutation to an in-memory snapshot, persists it to `localStorage`, resolves immediately, and appends the remote write to a durable outbox (`hero-web::outbox::<userId>`). A sync cycle (flush outbox in order → when empty, pull a fresh remote snapshot → publish to `subscribe` listeners) runs ~800ms after each mutation, every 45s, and on focus/online/visibility. Same-row ops coalesce (insert+update → insert, insert+delete → nothing). Network errors / 401 / 5xx keep the op and retry ("offline" status); a duplicate-key (23505) insert becomes an update; a foreign-key miss (23503) re-inserts without the project/parent reference; other 4xx drop the op and fire `onRejected`, which the hook shows as an error toast. The hook ignores same-user auth events (supabase-js fires SIGNED_IN on every tab-visible) so the store is not rebuilt mid-sync. The hook exposes `syncStatus` and `syncNow`. Boot is instant when a cached snapshot exists; only a first sign-in on a device awaits the network.

### Data layer files (`client/src/lib/`)

- `heroStore.types.ts` — pure types, constants, UUID helpers, and domain↔row marshaling (`mapProjectRow`, `toItemPatch`, etc.) shared by both stores. No React, no Supabase client, no I/O.
- `heroAuth.ts` — the only file that imports `@supabase/supabase-js`. Owns the supabase client (configured with `autoRefreshToken: false` — we own the refresh path) and the access-token cache. Exports `getAccessToken()` which returns a cached token if ≥60s life remaining, otherwise runs a single-flight `POST /auth/v1/token?grant_type=refresh_token` with a 10s timeout. Also exports `onAuthChange`, `signInWithPassword`, `signUpWithPassword`, `signOut`, `getInitialSession`. **Never call `supabase.auth.*` from inside an `onAuthChange` handler** — it fires from inside `_acquireLock`-held code and re-queuing there is how sleep/wake wedges happen.
- `heroStore.local.ts` — `createLocalStore(userId)`. Stateless: each method reads localStorage, mutates, writes back. Also exports the seed snapshot / preferences helpers.
- `heroStore.remote.ts` — `createRemoteStore(userId, getAccessToken)`. Each method is a raw `fetch()` against `${SUPABASE_URL}/rest/v1/{table}` with `apikey` + `Authorization: Bearer` headers and `Prefer: return=representation` on INSERT/UPDATE. One 10s `AbortController` timeout that stays armed through `await response.json()` so a stalled HTTP/2 body read aborts instead of hanging. Non-2xx throws `PostgrestRequestError` (carries HTTP status + Postgres code); 0-row PATCH/DELETE throws a 404 `"Item not found."`. `42P01` throws `SchemaMissingError` which the bootstrap effect catches to swap to the local store.
- `heroStore.synced.ts` — `createSyncedStore(userId, remote)`. The local-first wrapper described above. Never used directly by the UI; the hook subscribes to it for background pulls and disposes it on sign-out.

The rewrite explicitly avoids routing data calls through `supabase.from(...)` because supabase-js's `_acquireLock` checks an in-memory `lockAcquired` boolean before invoking the configured lock function, and a fetch zombied during laptop sleep/wake leaves that boolean `true` forever — hanging every subsequent data call. Going around supabase-js for CRUD makes the wedge structurally impossible. Do not reintroduce `supabase.from(...)`, and do not add optimistic-UI shortcuts that update React state before the store promise resolves — an earlier revision did that and silently lost writes when the fallback local snapshot was later overwritten by a remote reload.

### Supabase schema

`supabase/schema.sql` is the canonical schema and must be applied manually via the Supabase SQL editor (there is no migration tool). Two tables: `projects` and `items`. Both have RLS policies enforcing `auth.uid() = user_id` for all verbs. `items.broken_down_from_id` self-references `items.id` for the "break down a task into a smaller step" chain feature.

### Routing & UI shape

- `client/src/App.tsx` — wouter `<Switch>` with four routes: `/` and `/all` both render `Home`, plus `/analytics`, `/done`, `/404`. `ThemeProvider` + `TooltipProvider` + sonner `Toaster` wrap everything.
- `client/src/pages/Home.tsx` (~1500 lines) — the entire keyboard-driven Today/Tomorrow/All view, per-project containers, drag-and-drop, inline edit, auth shell, and help panel all live in this one file. Every project renders as its own container (`columns` memo; an "Unsorted" container appears only for items whose project no longer exists), all visible at once in an auto-fit grid, each with its own one-line composer. Enter saves once: a parseable time is used, otherwise the task wakes up in 5 minutes (no confirmation step). Dragging a row onto another row calls `hero.moveItem` (retimes to slot below the target *and* adopts its project); dragging onto a container's background calls `hero.moveItemToProject` (project change only). Keyboard navigation walks all containers in order. The app is intentionally keyboard-first (see the `HelpPanel` component for the full shortcut reference: `T`/`⇧N`, `↑`/`↓`, `⇧⌘D`, `⇧⌘⌫`, `⇧⌘1`, `Space`, `Enter`, `Esc`, `Z`/`U`, etc.). The mark-done flow is deliberately pessimistic: `markDone` captures the row + button position, awaits `hero.markDone(itemId)`, and only spawns confetti + plays the leaving animation on `result.ok` — no optimistic UI rollback (the synced store makes that await instant anyway). A per-item `pendingMutations` set gates re-entry while the mutation is in flight.
- `client/src/pages/{Analytics,Done,NotFound}.tsx` — secondary views, each reads from `useHeroApp()`.
- `client/src/components/ui/` — shadcn/ui components (New York style, neutral baseColor; see `components.json`). Tailwind v4 is wired via `@tailwindcss/vite`; there is no `tailwind.config.js` — config lives in `client/src/index.css` via `@theme`.

### Capture parsing

Natural-language capture (e.g. "follow up with Maya tomorrow 9am") is parsed with `chrono-node` in `parseCaptureInput`. Daypart words ("morning", "afternoon", "evening", "tonight") get sensible default clock times via `applyDaypartDefaults` when chrono didn't pin an explicit hour. Times are resolved against the user's IANA timezone, which is cached in `localStorage` under `hero-timezone` on first run.

### Path aliases

`tsconfig.json` + `vite.config.ts` both define:
- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets/*` → `attached_assets/*` (Vite only)

### Server

`server/index.ts` is ~30 lines — Express with `express.static` pointing at `dist/public` and a `GET *` fallback to `index.html` for SPA routing. There is no API; all persistence goes directly from the browser to Supabase.

## Conventions visible in the code

- Most files open with a `/* Design note for this file: ... */` block describing intent. Preserve or update these when refactoring — they are the closest thing the repo has to design docs.
- Commit messages are long-form "Checkpoint:" summaries that explain *why* a change was made and what it replaces, not just *what* changed. Follow this style.
