/*
Design note for this file:
- The local-first HeroStore used in live (Supabase) mode. Every mutation applies
  to an in-memory snapshot, persists it to localStorage, and resolves immediately;
  the matching remote write is appended to a durable outbox (also localStorage)
  and flushed in the background. The UI never waits on the network after boot.
- Boot is instant when a cached snapshot exists: loadSnapshot returns the cache
  and kicks off a sync. Only a first-ever sign-in (no cache) awaits the remote.
- One sync cycle = flush the outbox in order, then, once it is empty, pull a
  fresh remote snapshot and publish it to subscribers. Cycles run shortly after
  each mutation, on a timer, and when the tab regains focus or comes back online.
  Cycles are single-flight; a mutation during a cycle queues one more.
- Outbox ops for the same row coalesce (insert+update → insert, update+update →
  merged update, insert+delete → nothing) so a burst of edits costs one request.
  An op is only coalesced into an earlier op when that would not reorder it ahead
  of a project / parent-item insert it references.
- Failure policy: network errors, timeouts, missing token, 401/408/429/5xx keep
  the op and retry later ("offline"). A duplicate-key (23505) insert converts to
  an update (the previous attempt landed but the response was lost). A foreign
  key miss (23503 — the project or parent task no longer exists remotely) retries
  the insert without that reference so the task lands in Unsorted instead of
  vanishing. Any other 4xx drops the op, because replaying it can never succeed,
  and reports it through onRejected so the UI can say so — the next pull would
  otherwise erase the row with no explanation.
- A disposed store (sign-out, user switch) must stop touching shared storage:
  its in-flight request may still resolve, but it no longer persists the outbox
  or the snapshot, so it can't clobber what its replacement wrote.
- Still no supabase-js data calls, and no optimistic React state: the hook sets
  state from the row this store returns, exactly as with the other stores.
*/

import {
  PostgrestRequestError,
  SchemaMissingError,
  ensureRemoteSafeItem,
  ensureRemoteSafeProject,
  type HeroItem,
  type HeroProject,
  type HeroSnapshot,
  type HeroStore,
} from "./heroStore.types";
import { persistLocalSnapshot, readLocalSnapshot } from "./heroStore.local";

const OUTBOX_KEY_PREFIX = "hero-web::outbox::";
const FLUSH_DELAY_MS = 800;
const PULL_INTERVAL_MS = 45_000;
const RETRY_DELAY_MS = 15_000;

export type SyncStatus = "idle" | "pending" | "syncing" | "offline" | "error";

type ProjectPatch = Partial<Pick<HeroProject, "name" | "tone">>;

type PendingOp =
  | { kind: "insertProject"; id: string; project: HeroProject }
  | { kind: "updateProject"; id: string; patch: ProjectPatch }
  | { kind: "insertItem"; id: string; item: HeroItem }
  | { kind: "updateItem"; id: string; patch: Partial<HeroItem> }
  | { kind: "deleteItem"; id: string };

export interface SyncedStore extends HeroStore {
  /** Fires whenever a background pull changes the snapshot. */
  subscribe(listener: (snapshot: HeroSnapshot) => void): () => void;
  /** Fires when the server permanently rejects a local write (it was dropped). */
  onRejected(listener: (message: string) => void): () => void;
  /** Fires on every sync status transition. */
  onStatus(listener: (status: SyncStatus, message?: string) => void): () => void;
  /** Flush the outbox and pull now (single-flight; re-queues if one is running). */
  syncNow(): Promise<void>;
  /** Number of local writes not yet confirmed by the server. */
  pendingCount(): number;
  dispose(): void;
}

function outboxKey(userId: string) {
  return `${OUTBOX_KEY_PREFIX}${userId}`;
}

function readOutbox(userId: string): PendingOp[] {
  try {
    const raw = window.localStorage.getItem(outboxKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingOp[]) : [];
  } catch {
    return [];
  }
}

function persistOutbox(userId: string, ops: PendingOp[]) {
  if (ops.length === 0) {
    window.localStorage.removeItem(outboxKey(userId));
    return;
  }
  window.localStorage.setItem(outboxKey(userId), JSON.stringify(ops));
}

/** Pure: the snapshot after one op. Used for local application and for rebasing
 *  queued ops onto a freshly pulled remote snapshot. */
function applyOp(snapshot: HeroSnapshot, op: PendingOp): HeroSnapshot {
  switch (op.kind) {
    case "insertProject":
      if (snapshot.projects.some((project) => project.id === op.id)) return snapshot;
      return { projects: [...snapshot.projects, op.project], items: snapshot.items };
    case "updateProject":
      return {
        projects: snapshot.projects.map((project) =>
          project.id === op.id
            ? { ...project, name: op.patch.name ?? project.name, tone: op.patch.tone ?? project.tone }
            : project,
        ),
        items: snapshot.items,
      };
    case "insertItem":
      if (snapshot.items.some((item) => item.id === op.id)) return snapshot;
      return { projects: snapshot.projects, items: [...snapshot.items, op.item] };
    case "updateItem":
      return {
        projects: snapshot.projects,
        items: snapshot.items.map((item) => (item.id === op.id ? { ...item, ...op.patch } : item)),
      };
    case "deleteItem":
      return { projects: snapshot.projects, items: snapshot.items.filter((item) => item.id !== op.id) };
    default:
      return snapshot;
  }
}

function isRetryable(error: unknown) {
  if (error instanceof SchemaMissingError) return true;
  if (error instanceof PostgrestRequestError) {
    return error.status >= 500 || error.status === 401 || error.status === 408 || error.status === 429;
  }
  // No HTTP status: fetch failed, timed out, or no access token yet.
  return true;
}

// PostgREST answers 409 for both unique (23505) and foreign-key (23503)
// violations, so the status alone can't tell "already inserted" apart from
// "references a row the server doesn't have".
function isDuplicate(error: unknown) {
  return (
    error instanceof PostgrestRequestError &&
    (error.code === "23505" || (error.code === undefined && /duplicate key/i.test(error.message)))
  );
}

function isMissingReference(error: unknown) {
  return error instanceof PostgrestRequestError && error.code === "23503";
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createSyncedStore(userId: string, remote: HeroStore): SyncedStore {
  let snapshot: HeroSnapshot = { projects: [], items: [] };
  let snapshotJson = "";
  let outbox: PendingOp[] = readOutbox(userId);
  let inFlight: PendingOp | null = null;

  let status: SyncStatus = outbox.length ? "pending" : "idle";
  let syncing: Promise<void> | null = null;
  let syncQueued = false;
  let flushTimer: number | null = null;
  let pullTimer: number | null = null;
  let disposed = false;
  let started = false;

  const snapshotListeners = new Set<(snapshot: HeroSnapshot) => void>();
  const statusListeners = new Set<(status: SyncStatus, message?: string) => void>();
  const rejectedListeners = new Set<(message: string) => void>();

  function setStatus(next: SyncStatus, message?: string) {
    if (status === next && !message) return;
    status = next;
    statusListeners.forEach((listener) => listener(next, message));
  }

  function commitSnapshot(next: HeroSnapshot, publish: boolean) {
    const json = JSON.stringify(next);
    if (json === snapshotJson) return;
    snapshot = next;
    snapshotJson = json;
    persistLocalSnapshot(userId, next);
    if (publish) snapshotListeners.forEach((listener) => listener(next));
  }

  function referencesLaterInsert(patch: Partial<HeroItem>, fromIndex: number) {
    const refs = [patch.projectId, patch.brokenDownFromId].filter(Boolean) as string[];
    if (!refs.length) return false;
    return outbox.some(
      (op, index) =>
        index > fromIndex &&
        (op.kind === "insertProject" || op.kind === "insertItem") &&
        refs.includes(op.id),
    );
  }

  function enqueue(op: PendingOp) {
    const index = outbox.findIndex((existing) => existing.id === op.id);
    const existing = index >= 0 ? outbox[index] : null;
    let next = outbox;

    if (existing && op.kind === "updateItem" && existing.kind === "insertItem" && !referencesLaterInsert(op.patch, index)) {
      next = outbox.map((entry, i) =>
        i === index ? { ...existing, item: { ...existing.item, ...op.patch } } : entry,
      );
    } else if (existing && op.kind === "updateItem" && existing.kind === "updateItem" && !referencesLaterInsert(op.patch, index)) {
      next = outbox.map((entry, i) =>
        i === index ? { ...existing, patch: { ...existing.patch, ...op.patch } } : entry,
      );
    } else if (existing && op.kind === "deleteItem" && existing.kind === "insertItem") {
      next = outbox.filter((entry) => entry.id !== op.id);
    } else if (existing && op.kind === "deleteItem" && existing.kind === "updateItem") {
      next = [...outbox.filter((entry) => entry.id !== op.id), op];
    } else if (existing && op.kind === "updateProject" && existing.kind === "insertProject") {
      next = outbox.map((entry, i) =>
        i === index ? { ...existing, project: { ...existing.project, ...op.patch } } : entry,
      );
    } else if (existing && op.kind === "updateProject" && existing.kind === "updateProject") {
      next = outbox.map((entry, i) =>
        i === index ? { ...existing, patch: { ...existing.patch, ...op.patch } } : entry,
      );
    } else {
      next = [...outbox, op];
    }

    outbox = next;
    persistOutbox(userId, outbox);
    if (outbox.length) setStatus("pending");
    scheduleFlush();
  }

  function scheduleFlush(delay = FLUSH_DELAY_MS) {
    if (disposed) return;
    if (flushTimer !== null) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void syncNow();
    }, delay);
  }

  function schedulePull() {
    if (disposed) return;
    if (pullTimer !== null) window.clearInterval(pullTimer);
    pullTimer = window.setInterval(() => void syncNow(), PULL_INTERVAL_MS);
  }

  async function performOp(op: PendingOp) {
    switch (op.kind) {
      case "insertProject":
        try {
          await remote.insertProject(op.project);
        } catch (error) {
          if (!isDuplicate(error)) throw error;
          await remote.updateProject(op.id, { name: op.project.name, tone: op.project.tone });
        }
        return;
      case "updateProject":
        await remote.updateProject(op.id, op.patch);
        return;
      case "insertItem":
        try {
          await remote.insertItem(op.item);
        } catch (error) {
          if (isMissingReference(error)) {
            console.warn("[hero][sync] insert referenced a missing row; saving without it", op.id, describe(error));
            await remote.insertItem({ ...op.item, projectId: undefined, brokenDownFromId: undefined });
            return;
          }
          if (!isDuplicate(error)) throw error;
          const { id: _id, ...rest } = op.item;
          await remote.updateItem(op.id, rest);
        }
        return;
      case "updateItem":
        await remote.updateItem(op.id, op.patch);
        return;
      case "deleteItem":
        await remote.deleteItem(op.id);
        return;
    }
  }

  /** Drains the outbox in order. Returns true when nothing is left. */
  async function flush(): Promise<boolean> {
    while (outbox.length && !disposed) {
      const op = outbox[0];
      inFlight = op;
      outbox = outbox.slice(1);
      try {
        await performOp(op);
      } catch (error) {
        if (disposed) return false;
        if (isRetryable(error)) {
          outbox = [op, ...outbox];
          inFlight = null;
          persistOutbox(userId, outbox);
          throw error;
        }
        console.error("[hero][sync] dropping unfulfillable write", op.kind, op.id, describe(error));
        const message = rejectionMessage(op, error);
        if (message) rejectedListeners.forEach((listener) => listener(message));
      }
      // Our replacement owns the persisted outbox now; it will replay this op
      // (idempotently) rather than have us overwrite its queue.
      if (disposed) return false;
      inFlight = null;
      persistOutbox(userId, outbox);
    }
    return outbox.length === 0;
  }

  function rejectionMessage(op: PendingOp, error: unknown) {
    const reason = describe(error);
    switch (op.kind) {
      case "insertItem":
        return `The server rejected “${op.item.title}”: ${reason}`;
      case "updateItem":
      case "deleteItem": {
        // A write to a row deleted elsewhere is expected and not worth a toast.
        if (error instanceof PostgrestRequestError && error.status === 404) return null;
        const title = snapshot.items.find((item) => item.id === op.id)?.title;
        return `Couldn't sync a change${title ? ` to “${title}”` : ""}: ${reason}`;
      }
      case "insertProject":
        return `The server rejected project “${op.project.name}”: ${reason}`;
      case "updateProject":
        return `Couldn't sync a project change: ${reason}`;
    }
  }

  async function pull() {
    const fresh = await remote.loadSnapshot();
    if (disposed) return;
    // Anything queued while the pull was in flight is newer than the server's
    // view; rebase it on top so local intent is never clobbered by a pull.
    let next = fresh;
    for (const op of [inFlight, ...outbox]) {
      if (op) next = applyOp(next, op);
    }
    commitSnapshot(next, true);
  }

  async function runSync() {
    if (disposed) return;
    setStatus(outbox.length ? "syncing" : status === "offline" || status === "error" ? "syncing" : status);
    try {
      const drained = await flush();
      if (drained) {
        await pull();
        setStatus("idle");
      }
    } catch (error) {
      if (error instanceof SchemaMissingError) {
        setStatus("error", error.message);
      } else {
        setStatus("offline", describe(error));
      }
      scheduleFlush(RETRY_DELAY_MS);
    }
  }

  async function syncNow() {
    if (disposed) return;
    if (syncing) {
      syncQueued = true;
      return syncing;
    }
    syncing = (async () => {
      do {
        syncQueued = false;
        await runSync();
      } while (syncQueued && !disposed);
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  function onVisible() {
    if (document.visibilityState === "visible") void syncNow();
  }

  function onOnline() {
    void syncNow();
  }

  function start() {
    if (started || disposed) return;
    started = true;
    schedulePull();
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    scheduleFlush(0);
  }

  return {
    async loadSnapshot() {
      const cached = readLocalSnapshot(userId);
      if (cached) {
        commitSnapshot(cached, false);
        start();
        return snapshot;
      }
      // First sign-in on this device: nothing to show yet, so wait for the server.
      const fresh = await remote.loadSnapshot();
      commitSnapshot(fresh, false);
      start();
      return snapshot;
    },

    async insertProject(project) {
      const safeProject = ensureRemoteSafeProject(project);
      commitSnapshot(applyOp(snapshot, { kind: "insertProject", id: safeProject.id, project: safeProject }), false);
      enqueue({ kind: "insertProject", id: safeProject.id, project: safeProject });
      return safeProject;
    },

    async updateProject(projectId, patch) {
      const target = snapshot.projects.find((project) => project.id === projectId);
      if (!target) throw new Error("Project not found.");
      const op: PendingOp = { kind: "updateProject", id: projectId, patch };
      commitSnapshot(applyOp(snapshot, op), false);
      enqueue(op);
      return snapshot.projects.find((project) => project.id === projectId) ?? target;
    },

    async insertItem(item) {
      const safeItem = ensureRemoteSafeItem(item);
      const op: PendingOp = { kind: "insertItem", id: safeItem.id, item: safeItem };
      commitSnapshot(applyOp(snapshot, op), false);
      enqueue(op);
      return safeItem;
    },

    async updateItem(itemId, patch) {
      const target = snapshot.items.find((item) => item.id === itemId);
      if (!target) throw new Error("Item not found.");
      const fullPatch = { ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
      const op: PendingOp = { kind: "updateItem", id: itemId, patch: fullPatch };
      commitSnapshot(applyOp(snapshot, op), false);
      enqueue(op);
      return snapshot.items.find((item) => item.id === itemId) ?? { ...target, ...fullPatch };
    },

    async deleteItem(itemId) {
      if (!snapshot.items.some((item) => item.id === itemId)) throw new Error("Item not found.");
      const op: PendingOp = { kind: "deleteItem", id: itemId };
      commitSnapshot(applyOp(snapshot, op), false);
      enqueue(op);
    },

    subscribe(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },

    onRejected(listener) {
      rejectedListeners.add(listener);
      return () => rejectedListeners.delete(listener);
    },

    onStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },

    syncNow,

    pendingCount() {
      return outbox.length + (inFlight ? 1 : 0);
    },

    dispose() {
      disposed = true;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (pullTimer !== null) window.clearInterval(pullTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      snapshotListeners.clear();
      statusListeners.clear();
      rejectedListeners.clear();
    },
  };
}
