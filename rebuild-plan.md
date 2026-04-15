# Hero Web Rebuild Plan

## Recommended product direction

The new product should remain a **fast, opinionated task-and-link resurfacing tool** rather than turning into a broad project-management suite. The web version should preserve the original strengths:

- rapid capture,
- natural-language scheduling,
- one unified upcoming list,
- keyboard-first desktop operation,
- mobile usability without losing speed,
- strong completion and resnooze flows,
- lightweight but motivating done history.

The new feature set should add:

- **Google login**,
- **hosted persistence**,
- **multi-device sync**,
- **user-defined projects/tags**,
- **responsive design**.

## Technology decision based on the initialized scaffold

The initialized project is a **static React 19 + Tailwind 4 + shadcn/ui** application using **Wouter** for routing. Because the template is explicitly frontend-only, the most compatible architecture is:

| Layer | Decision |
| --- | --- |
| Frontend | React 19 SPA in the provided scaffold |
| Routing | Wouter |
| Styling | Tailwind 4 + custom design tokens |
| Auth | Supabase Auth with Google OAuth |
| Database | Supabase Postgres with Row Level Security |
| Hosting | Prefer Manus publish flow or Vercel; Supabase is the backend, not the frontend host |
| Notifications | In-app due queue first, optional browser notifications second |

This is the cleanest fit because Supabase can be used directly from a static frontend using a publishable key and RLS.

## Product model

The original extension handled two core item types: tasks and snoozed tabs. The web rebuild should keep that distinction but present them through a unified UI model.

| Domain concept | Purpose |
| --- | --- |
| User | Authenticated owner of all data |
| Project | User-defined grouping such as personal, work, reading |
| Item | Unified UI model representing either a task or a saved link |
| Reminder | Due date/time on an item |
| Completion | Archive record or status transition |
| Activity event | Optional analytics/history for motivation and audit |

## Data model proposal for Supabase

### `projects`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | generated |
| `user_id` | uuid | references auth user |
| `name` | text | user-defined, unique per user |
| `slug` | text | optional normalized identifier |
| `color` | text | token such as moss, slate, amber |
| `position` | int | ordering in UI |
| `created_at` | timestamptz | default now |

### `items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | generated |
| `user_id` | uuid | owner |
| `type` | text | `task` or `link` |
| `title` | text | task text or saved page title |
| `url` | text nullable | only for link items |
| `notes` | text nullable | optional future use |
| `project_id` | uuid nullable | first-release tagging model |
| `due_at` | timestamptz nullable | scheduled reminder |
| `status` | text | `upcoming`, `done`, `archived` |
| `is_recurring_daily` | boolean | preserve legacy recurring behavior |
| `broken_down_from_id` | uuid nullable | supports “break it down” lineage |
| `original_title` | text nullable | preserve wake-up reference when task is broken down |
| `created_at` | timestamptz | default now |
| `updated_at` | timestamptz | default now |
| `completed_at` | timestamptz nullable | completion timestamp |

### `activity_events` (optional but recommended)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | generated |
| `user_id` | uuid | owner |
| `item_id` | uuid nullable | related item |
| `event_type` | text | create, delete, done, reschedule, open, login |
| `payload` | jsonb | lightweight details |
| `created_at` | timestamptz | default now |

### RLS policy direction

Each table should only expose rows where `auth.uid() = user_id`. This keeps the app safely frontend-driven without a custom backend.

## UX structure

### Routes

| Route | Purpose |
| --- | --- |
| `/` | authenticated app shell or sign-in screen |
| `/due/:id` | focused due-item resolution view |
| `/done` | completion archive and lightweight stats |
| `/settings` | project management and preferences |
| `/auth/callback` | optional OAuth landing route if needed |

### Main interface modules

| Module | Description |
| --- | --- |
| Quick add | Fast task or link capture with natural-language time input |
| Project strip | Filter by project, including All items |
| Upcoming list | Unified queue of tasks and links sorted by due time |
| Today / overdue rail | Surface actionable urgency clearly |
| Done snapshot | Recent completions and streak cues |
| Command hints | Desktop shortcut legend embedded into the layout |

## Legacy behavior mapping

| Legacy extension behavior | Web implementation |
| --- | --- |
| Popup capture | Persistent quick-add sheet / command bar |
| Alt-key flows | Desktop keyboard shortcuts plus mobile actions |
| `chrome.storage.local` arrays | Supabase tables with per-user access |
| Background alarm opens item | In-app due screen plus browser notification when permitted |
| Unified upcoming table | Unified responsive list/cards with selection state |
| Inline natural-language date edit | Inline or sheet-based reschedule flow |
| Done screen with streaks | Done page with streak and recent-completion metrics |
| Break-it-down task due page | Dedicated due route with “smaller next step” flow |

## Tagging / projects design

The user asked for tagging tasks with projects such as personal and work. For the first release, the simplest and fastest model is **one primary project per item**. This preserves filtering clarity and keeps the UI extremely fast. If the user later wants true multi-tagging, the schema can evolve to an `item_projects` join table.

## Mobile behavior

Desktop should preserve the keyboard-centered spirit. Mobile should translate it rather than imitate it literally.

| Desktop | Mobile |
| --- | --- |
| Full split layout | Single-column planner stack |
| Keyboard navigation and shortcuts | Bottom quick-actions and swipe-friendly controls |
| Inline edits | Drawer/sheet edits |
| Hover hints | Always-visible compact action chips |

## Notification strategy

A browser-based app cannot replicate extension-level reopening exactly. Therefore:

1. the app should maintain a due queue,
2. show overdue items prominently on load,
3. optionally request browser notification permission,
4. deep-link notification clicks into `/due/:id`,
5. avoid opening multiple due items automatically.

This preserves the spirit of the old behavior without fighting browser limitations.

## Implementation phases

### Phase A — Foundation

- Establish visual system from the selected tactile paper design.
- Add routes and core layout.
- Build local mock state so the UI can be completed before wiring external services.

### Phase B — Core app experience

- Quick add.
- Upcoming list.
- Project filtering.
- Done actions.
- Rescheduling and rename flows.
- Due view with break-it-down option.
- Responsive behavior.

### Phase C — Supabase integration

- Install `@supabase/supabase-js`.
- Add environment-based client setup.
- Wire Google OAuth login/logout.
- Replace mock state with live queries/mutations.
- Add empty/loading/auth states.

### Phase D — Polish and delivery

- Improve motion, accessibility, and keyboard handling.
- Add done metrics.
- Add setup documentation for Supabase and Google OAuth.
- Prepare GitHub repository and deployment guidance.

## Expected external dependencies / blockers

Two parts may require user participation:

| Dependency | Why user help may be required |
| --- | --- |
| Supabase project | A live project URL and publishable key are required, and Google OAuth must be enabled in that project |
| Google OAuth credentials | Google Cloud OAuth client creation usually happens inside the user’s account |
| Vercel deployment | If deployed to the user’s Vercel account, login or takeover may be required |

## Practical delivery strategy

The best execution path is:

1. build the full frontend now,
2. wire it to a clean Supabase integration layer,
3. create the GitHub repository and push the code,
4. if credentials are available, finish live Supabase auth/database setup,
5. otherwise provide exact setup steps and a deployment-ready codebase.

## Success criteria

The rebuild is successful if it delivers the following:

- users can sign in with Google,
- tasks and saved links sync across devices,
- project tagging and filtering are first-class,
- the UI remains materially faster and more opinionated than a generic task app,
- the experience works well on desktop and mobile,
- the repository is created and pushed,
- deployment is ready, and ideally completed if credentials and account access are available.
