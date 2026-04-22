/*
Design note for this file:
- The HeroStore implementation that talks to Supabase PostgREST directly — no
  supabase-js, no _acquireLock, no per-mutation getSession(). Each method gets a
  token from heroAuth.getAccessToken() (which handles single-flight refresh) and
  issues one raw fetch() with the API key + Authorization: Bearer + PostgREST's
  return-representation header so we can map the response row back into a
  HeroItem/HeroProject.
- Timeouts cover the full exchange including body read (Chrome's HTTP/2 can
  half-die and deliver headers but never finish the body; the 10s timer stays
  armed through response.json()).
- Zero-row PATCH / DELETE surfaces as `Error("Item not found.")` so the hook's
  MutationResult stays the same whether the row was deleted on another device
  or never existed.
- 42P01 (undefined_table) at loadSnapshot time throws SchemaMissingError so the
  bootstrap effect can detect "database tables are not ready yet" without
  swallowing other errors (RLS violations, network failures, etc.).
*/

import {
  SchemaMissingError,
  mapItemRow,
  mapProjectRow,
  toItemInsert,
  toItemPatch,
  toProjectInsert,
  type HeroItem,
  type HeroProject,
  type HeroSnapshot,
  type HeroStore,
  type ItemRow,
  type ProjectRow,
} from "./heroStore.types";
import { supabaseApiKey, supabaseRestUrl } from "./heroAuth";

interface PostgrestErrorBody {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

async function parseErrorBody(response: Response): Promise<PostgrestErrorBody> {
  try {
    const body = (await response.json()) as PostgrestErrorBody;
    if (body && typeof body === "object") return body;
  } catch {
    // fall through
  }
  return {};
}

function errorMessageFrom(body: PostgrestErrorBody, status: number): string {
  return body.hint || body.message || `Request failed with status ${status}.`;
}

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: string;
  body?: unknown;
  prefer?: string;
}

/**
 * One fetch, one 10s timeout that stays armed through the body read.
 * Throws on non-2xx with the server's hint/message. Throws SchemaMissingError
 * on PostgREST 42P01. Returns parsed JSON (or null for 204).
 */
async function postgrestFetch<T>(
  getAccessToken: () => Promise<string | null>,
  options: RequestOptions,
): Promise<T | null> {
  if (!supabaseRestUrl || !supabaseApiKey) {
    throw new Error("Supabase is not configured.");
  }

  const token = await getAccessToken();
  if (!token) {
    throw new Error("Please sign in first.");
  }

  const url = `${supabaseRestUrl}/${options.path}${options.query ? `?${options.query}` : ""}`;
  const headers: Record<string, string> = {
    apikey: supabaseApiKey,
    Authorization: `Bearer ${token}`,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.prefer) {
    headers.Prefer = options.prefer;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, 10_000);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await parseErrorBody(response);
      if (errorBody.code === "42P01") {
        throw new SchemaMissingError(errorMessageFrom(errorBody, response.status));
      }
      const message = errorMessageFrom(errorBody, response.status);
      console.warn("[hero][db]", options.method, options.path, response.status, message);
      throw new Error(message);
    }

    if (response.status === 204) return null;
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function createRemoteStore(
  userId: string,
  getAccessToken: () => Promise<string | null>,
): HeroStore {
  const idAndUserFilter = (id: string) =>
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`;

  const userFilter = `user_id=eq.${encodeURIComponent(userId)}`;

  return {
    async loadSnapshot(): Promise<HeroSnapshot> {
      const [projectRows, itemRows] = await Promise.all([
        postgrestFetch<ProjectRow[]>(getAccessToken, {
          method: "GET",
          path: "projects",
          query: `select=*&${userFilter}&order=created_at.asc`,
        }),
        postgrestFetch<ItemRow[]>(getAccessToken, {
          method: "GET",
          path: "items",
          query: `select=*&${userFilter}&order=due_at.asc`,
        }),
      ]);

      return {
        projects: (projectRows ?? []).map(mapProjectRow),
        items: (itemRows ?? []).map(mapItemRow),
      };
    },

    async insertProject(project: HeroProject): Promise<HeroProject> {
      const rows = await postgrestFetch<ProjectRow[]>(getAccessToken, {
        method: "POST",
        path: "projects",
        prefer: "return=representation",
        body: toProjectInsert(project, userId),
      });
      if (!rows || rows.length === 0) {
        throw new Error("Project insert returned no row.");
      }
      return mapProjectRow(rows[0]);
    },

    async updateProject(projectId, patch): Promise<HeroProject> {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.tone !== undefined) body.tone = patch.tone;

      const rows = await postgrestFetch<ProjectRow[]>(getAccessToken, {
        method: "PATCH",
        path: "projects",
        query: idAndUserFilter(projectId),
        prefer: "return=representation",
        body,
      });
      if (!rows || rows.length === 0) {
        throw new Error("Project not found.");
      }
      return mapProjectRow(rows[0]);
    },

    async insertItem(item: HeroItem): Promise<HeroItem> {
      const rows = await postgrestFetch<ItemRow[]>(getAccessToken, {
        method: "POST",
        path: "items",
        prefer: "return=representation",
        body: toItemInsert(item, userId),
      });
      if (!rows || rows.length === 0) {
        throw new Error("Item insert returned no row.");
      }
      return mapItemRow(rows[0]);
    },

    async updateItem(itemId, patch): Promise<HeroItem> {
      const rows = await postgrestFetch<ItemRow[]>(getAccessToken, {
        method: "PATCH",
        path: "items",
        query: idAndUserFilter(itemId),
        prefer: "return=representation",
        body: toItemPatch(patch),
      });
      if (!rows || rows.length === 0) {
        throw new Error("Item not found.");
      }
      return mapItemRow(rows[0]);
    },

    async deleteItem(itemId): Promise<void> {
      const rows = await postgrestFetch<ItemRow[]>(getAccessToken, {
        method: "DELETE",
        path: "items",
        query: idAndUserFilter(itemId),
        prefer: "return=representation",
      });
      if (!rows || rows.length === 0) {
        throw new Error("Item not found.");
      }
    },
  };
}
