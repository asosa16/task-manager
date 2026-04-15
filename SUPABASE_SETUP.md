# Hero Web — Supabase and Google OAuth Setup

## What is already in the repo

The frontend is prepared for a **static React deployment** with a **Supabase-ready authentication layer** and a proposed database schema in [`supabase/schema.sql`](./supabase/schema.sql).

The current app behavior is intentionally **local-first** until the live backend is connected. This means:

- the UI is fully usable now,
- Google sign-in can be activated once environment variables are added,
- hosted sync becomes available after the SQL schema is applied.

## Required environment variables

Create a `.env.local` file for local development or add these values in your hosting provider:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

## Supabase project setup

1. Create a Supabase project.
2. Open the SQL editor.
3. Run the SQL in [`supabase/schema.sql`](./supabase/schema.sql).
4. Confirm that the `projects` and `items` tables exist.
5. Confirm that Row Level Security is enabled.

## Google OAuth setup

Based on current Supabase documentation, the flow requires both **Supabase** and **Google Cloud** configuration.[1][2]

### In Google Cloud

1. Create a new OAuth client.
2. Choose **Web application**.
3. Add your site origins under **Authorized JavaScript origins**.
   - local example: `http://localhost:3000`
   - production example: `https://your-app.vercel.app`
4. Add the **Supabase callback URL** under **Authorized redirect URIs**.
   - retrieve this from the Google provider screen inside Supabase

### In Supabase

1. Open **Authentication → Providers → Google**.
2. Enable the provider.
3. Paste the Google client ID and client secret.
4. Set the site URL to your deployed frontend origin.
5. Add local and production redirect URLs as needed.

## Frontend behavior after setup

Once the variables are present and Google is enabled in Supabase:

- the **Continue with Google** flow can be used,
- Supabase sessions will be detected on return to the app,
- the repo is ready for the next patch that swaps local-first persistence for table-backed sync.

## Recommended next patch

The current codebase intentionally keeps state simple and fast. The next backend patch should:

1. read `projects` and `items` from Supabase after login,
2. persist create/update/delete mutations to those tables,
3. keep local state as an optimistic UI layer,
4. fall back gracefully when the schema is not available.

## Hosting recommendation

If you want the fastest supported path, use the platform’s built-in publish flow after saving a checkpoint. If you prefer **Vercel**, the app is compatible with a static frontend deployment, but external hosting may need additional manual configuration for environment variables and auth redirect URLs.

## Sources

[1]: https://supabase.com/docs/guides/auth/quickstarts/react
[2]: https://supabase.com/docs/guides/auth/social-login/auth-google
