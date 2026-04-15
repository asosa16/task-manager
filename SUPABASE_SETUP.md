# Hero Web: Supabase and Vercel Setup

This project is now wired for **Google sign-in via Supabase** and **live per-user persistence** using the `projects` and `items` tables defined in `supabase/schema.sql`.

The app still works without Supabase keys by falling back to demo mode. If Google auth succeeds but the schema has not been applied yet, the app temporarily uses a user-scoped local fallback and explains what is missing inside the UI.

## 1. Create a Supabase project

Create a new project in [Supabase](https://supabase.com/). Once it is ready, copy the following values from **Project Settings → API**.

| Variable | Source in Supabase |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key or anon key |

## 2. Apply the Hero schema

Open the SQL editor in Supabase and run the contents of `supabase/schema.sql`.

That script creates the following hosted data model.

| Object | Purpose |
| --- | --- |
| `public.projects` | User-defined task tags such as Personal, Work, or Reading |
| `public.items` | Tasks and saved links, including due dates, completion state, recurrence flag, and break-down metadata |
| RLS policies | Per-user row isolation for select, insert, update, and delete |

## 3. Enable Google auth

In **Authentication → Providers → Google**:

1. Enable the Google provider.
2. Create OAuth credentials in Google Cloud.
3. Copy the Google client ID and secret into Supabase.
4. Add your app URLs to the allowed redirect list.

Use these redirect shapes.

| Environment | Redirect URL to allow |
| --- | --- |
| Local development | `http://localhost:3000` |
| Manus preview | The current preview origin, if needed for testing |
| Vercel production | `https://YOUR-VERCEL-DOMAIN` |
| Vercel preview deployments | `https://YOUR-VERCEL-PROJECT.vercel.app` |

Also add the Supabase callback URL shown in the provider settings to your Google Cloud OAuth configuration.

## 4. Configure Vercel

This repo includes a `vercel.json` file so the React single-page app deploys correctly and client-side routes rewrite to `index.html`.

In Vercel, import the GitHub repository and set these environment variables.

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable/anon key used by the browser |

After the first deployment, copy the final Vercel domain back into Supabase and Google Cloud as an approved redirect origin if it is not already listed.

## 5. Expected runtime behavior

| Condition | App behavior |
| --- | --- |
| No Supabase env vars | Demo mode |
| Supabase auth configured, schema missing | Google auth works, app warns and uses local fallback |
| Supabase auth + schema configured | Full hosted sync with per-user data |

## 6. Notes for the current implementation

The current app supports the following hosted flows.

- Google sign-in through Supabase OAuth
- Create, rename, reschedule, complete, delete, and undo task actions
- Create user-defined project tags
- Per-user data isolation via RLS
- Local fallback if auth is live but tables are not yet available

## 7. Recommended go-live order

1. Apply the Supabase SQL schema.
2. Enable Google auth in Supabase and Google Cloud.
3. Add Vercel environment variables.
4. Deploy from GitHub to Vercel.
5. Add the final Vercel URL to Supabase and Google Cloud redirect settings.
6. Test sign-in, task creation, project tagging, done flow, and undo.
