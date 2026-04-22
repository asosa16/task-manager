/*
Design note for this file:
- Owns the Supabase auth client and the access-token cache the remote store uses.
- The rest of the app never touches supabase-js for data. That library stays on the
  cold path: OAuth redirect parsing, session persistence, sign-in/up/out, and the
  onAuthStateChange listener. Every hot-path CRUD call goes through getAccessToken()
  in this file and then a raw fetch() in heroStore.remote.ts — so none of supabase-js's
  _acquireLock machinery runs during user actions, which is the wedge we're rewriting
  to avoid.
- autoRefreshToken is OFF. We own the refresh path: a single-flight POST directly to
  /auth/v1/token?grant_type=refresh_token, with the response written back into our
  cache and mirrored into supabase-js via setSession() so a page reload sees the
  rotated token.
- IMPORTANT: do not call any supabase.auth.* method from inside an onAuthChange
  handler. The handler fires from inside _acquireLock-held code, and awaiting another
  auth call from there can re-queue on the lock.
*/

import {
  createClient,
  type AuthChangeEvent,
  type Session,
} from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: true,
          // Pass-through lock: supabase-js's _acquireLock still checks its own
          // in-memory state before the lock callback runs, so the pass-through
          // alone doesn't prevent the sleep/wake wedge documented at the top
          // of this file. Keeping it set because (a) it's the safest default
          // for a single-tab app and (b) none of our hot-path code depends on
          // cross-tab lock coordination anyway.
          lock: (_name, _acquireTimeout, fn) => fn(),
        },
      })
    : null;

export const supabaseRestUrl = supabaseUrl ? `${supabaseUrl}/rest/v1` : null;
export const supabaseApiKey = supabaseKey ?? null;

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

let cache: TokenCache | null = null;
let inflightRefresh: Promise<string | null> | null = null;
let seedStarted = false;
let seedPromise: Promise<void> | null = null;

function writeCacheFromSession(session: Session | null) {
  if (!session?.access_token || !session?.refresh_token) {
    cache = null;
    return;
  }
  const expiresAtSec = session.expires_at ?? 0;
  cache = {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAtMs: expiresAtSec * 1000,
  };
}

/**
 * Seed the cache from supabase-js's persisted session exactly once. Any
 * subsequent token updates come from refreshAccessToken() or from the
 * onAuthChange listener (via writeCacheFromSession).
 *
 * Wrapped in a 5s timeout so a wedged lock at boot can't hang the bootstrap
 * effect forever — the worst case becomes "user sees sign-in screen even
 * though they had a valid session," which is recoverable by signing in again.
 */
async function seedCache(): Promise<void> {
  if (!supabase || seedStarted) return seedPromise ?? Promise.resolve();
  seedStarted = true;

  seedPromise = (async () => {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 5000);
    });

    try {
      const getSession = supabase.auth.getSession().then(({ data }) => data.session ?? null);
      const session = await Promise.race([getSession, timeout]);
      writeCacheFromSession(session);
    } catch {
      writeCacheFromSession(null);
    }
  })();

  return seedPromise;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => {
    controller.abort(new DOMException("Token refresh timed out", "TimeoutError"));
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (!supabase || !supabaseUrl || !supabaseKey) return null;
  const current = cache;
  if (!current?.refreshToken) return null;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
        },
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      },
    );
  } catch (err) {
    console.warn("[hero][auth] refresh network error", err);
    return null;
  }

  if (response.status === 400 || response.status === 401) {
    cache = null;
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Sign-out through _acquireLock can wedge in the same way as anything
      // else; we've already cleared our cache, and the next onAuthChange
      // (whether it fires or not) will sync the UI.
    }
    return null;
  }

  if (!response.ok) {
    console.warn("[hero][auth] refresh server error", response.status);
    return null;
  }

  let payload: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    expires_in?: number;
  };

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    console.warn("[hero][auth] refresh payload parse error");
    return null;
  }

  if (!payload.access_token || !payload.refresh_token) return null;

  const expiresAtSec =
    payload.expires_at ?? Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600);
  cache = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAtMs: expiresAtSec * 1000,
  };

  // Best-effort mirror into supabase-js's localStorage so a reload picks up
  // the rotated refresh token. Don't await or surface the result — our cache
  // is authoritative from here.
  void supabase.auth
    .setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    })
    .catch(() => {
      // setSession traverses _acquireLock; failure here doesn't affect the
      // hot path.
    });

  return cache.accessToken;
}

/**
 * Returns a fresh access token, refreshing if the cached one has under 60s
 * of life left. Returns null if the user isn't signed in, or if refresh
 * fails because the refresh_token itself is dead — the caller should route
 * the user to sign-in in that case.
 *
 * Single-flight: concurrent callers share one in-flight refresh.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;

  if (!cache) {
    await seedCache();
    if (!cache) return null;
  }

  if (cache.expiresAtMs - Date.now() > 60_000) {
    return cache.accessToken;
  }

  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = refreshAccessToken();
  try {
    return await inflightRefresh;
  } finally {
    inflightRefresh = null;
  }
}

/**
 * Subscribe to supabase-js's auth state changes. The returned function
 * unsubscribes. The cache is kept in sync as a side effect — callers should
 * only worry about mapping session → user for their own UI needs.
 */
export function onAuthChange(
  handler: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    writeCacheFromSession(session);
    handler(event, session);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}

export async function getInitialSession(): Promise<Session | null> {
  if (!supabase) return null;
  await seedCache();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithPassword(
  email: string,
  password: string,
  emailRedirectTo: string,
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
}

export async function signOut() {
  if (!supabase) return;
  cache = null;
  await supabase.auth.signOut();
}
