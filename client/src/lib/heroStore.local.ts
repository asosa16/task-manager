/*
Design note for this file:
- The HeroStore implementation backed by window.localStorage. Used in two modes:
  (a) demo mode when no Supabase env vars are set, and
  (b) live-auth fallback when Supabase auth works but the schema hasn't been applied.
- Each method reads the full snapshot, mutates in memory, and writes it back. The hook
  holds the canonical React state; localStorage is the durability layer. The store does
  not hold its own long-lived cache — keeping it stateless avoids any chance of drifting
  from the on-disk snapshot if another tab or DevTools rewrites localStorage.
- Preferences (defaultProjectId, timezone) are persisted directly via the functions
  exported below; they are local in every mode, so they don't sit behind the HeroStore
  interface.
*/

import {
  createRecordId,
  ensureRemoteSafeItem,
  ensureRemoteSafeProject,
  normalizeSnapshotIds,
  type HeroItem,
  type HeroPreferences,
  type HeroProject,
  type HeroSnapshot,
  type HeroStore,
  type HeroUser,
} from "./heroStore.types";

const SNAPSHOT_KEY_PREFIX = "hero-web::snapshot::";
const PREFERENCES_KEY_PREFIX = "hero-web::prefs::";

function snapshotKey(userId: string) {
  return `${SNAPSHOT_KEY_PREFIX}${userId}`;
}

function preferencesKey(userId: string) {
  return `${PREFERENCES_KEY_PREFIX}${userId}`;
}

export function readLocalSnapshot(userId: string): HeroSnapshot | null {
  const raw = window.localStorage.getItem(snapshotKey(userId));
  if (!raw) return null;
  try {
    return normalizeSnapshotIds(JSON.parse(raw) as HeroSnapshot);
  } catch {
    return null;
  }
}

export function persistLocalSnapshot(userId: string, snapshot: HeroSnapshot) {
  window.localStorage.setItem(snapshotKey(userId), JSON.stringify(snapshot));
}

export function readPreferences(userId: string): HeroPreferences {
  const raw = window.localStorage.getItem(preferencesKey(userId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as HeroPreferences;
  } catch {
    return {};
  }
}

export function persistPreferences(userId: string, preferences: HeroPreferences) {
  window.localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
}

function offsetHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createSeedProjects(): HeroProject[] {
  const now = new Date().toISOString();
  return [
    { id: createRecordId(), name: "Personal", tone: "moss", createdAt: now },
    { id: createRecordId(), name: "Work", tone: "slate", createdAt: now },
    { id: createRecordId(), name: "Reading", tone: "amber", createdAt: now },
  ];
}

function createSeedItems(projects: HeroProject[]): HeroItem[] {
  const now = new Date().toISOString();
  return [
    {
      id: createRecordId(),
      title: "Write the launch plan for Hero Web",
      type: "task",
      status: "upcoming",
      dueAt: offsetHours(-2),
      createdAt: now,
      updatedAt: now,
      projectId: projects[1]?.id,
      originalTitle: "Write the launch plan for Hero Web",
    },
    {
      id: createRecordId(),
      title: "Renew passport before summer travel",
      type: "task",
      status: "upcoming",
      dueAt: offsetHours(18),
      createdAt: now,
      updatedAt: now,
      projectId: projects[0]?.id,
      originalTitle: "Renew passport before summer travel",
    },
    {
      id: createRecordId(),
      title: "Read that essay on quiet software tools",
      type: "link",
      url: "https://example.com/quiet-tools",
      status: "upcoming",
      dueAt: offsetHours(42),
      createdAt: now,
      updatedAt: now,
      projectId: projects[2]?.id,
    },
    {
      id: createRecordId(),
      title: "Send proposal revision to Martina",
      type: "task",
      status: "done",
      dueAt: offsetHours(-22),
      createdAt: now,
      updatedAt: now,
      completedAt: offsetHours(-8),
      projectId: projects[1]?.id,
    },
  ];
}

export function createSeedSnapshot(): HeroSnapshot {
  const projects = createSeedProjects();
  return {
    projects,
    items: createSeedItems(projects),
  };
}

export function getDemoUser(): HeroUser {
  return {
    id: "demo-user",
    name: "Demo User",
    email: "demo@hero.local",
    mode: "demo",
  };
}

export function createLocalStore(userId: string): HeroStore {
  const readOrEmpty = (): HeroSnapshot =>
    readLocalSnapshot(userId) ?? { projects: [], items: [] };

  return {
    async loadSnapshot() {
      return readOrEmpty();
    },

    async insertProject(project) {
      const safeProject = ensureRemoteSafeProject(project);
      const snapshot = readOrEmpty();
      persistLocalSnapshot(userId, {
        projects: [...snapshot.projects, safeProject],
        items: snapshot.items,
      });
      return safeProject;
    },

    async updateProject(projectId, patch) {
      const snapshot = readOrEmpty();
      const target = snapshot.projects.find((project) => project.id === projectId);
      if (!target) throw new Error("Project not found.");

      const updated: HeroProject = {
        ...target,
        name: patch.name ?? target.name,
        tone: patch.tone ?? target.tone,
      };

      persistLocalSnapshot(userId, {
        projects: snapshot.projects.map((project) =>
          project.id === projectId ? updated : project,
        ),
        items: snapshot.items,
      });
      return updated;
    },

    async insertItem(item) {
      const safeItem = ensureRemoteSafeItem(item);
      const snapshot = readOrEmpty();
      persistLocalSnapshot(userId, {
        projects: snapshot.projects,
        items: [...snapshot.items, safeItem],
      });
      return safeItem;
    },

    async updateItem(itemId, patch) {
      const snapshot = readOrEmpty();
      const target = snapshot.items.find((item) => item.id === itemId);
      if (!target) throw new Error("Item not found.");

      const nextUpdatedAt = patch.updatedAt ?? new Date().toISOString();
      const updated: HeroItem = {
        ...target,
        ...patch,
        updatedAt: nextUpdatedAt,
      };

      persistLocalSnapshot(userId, {
        projects: snapshot.projects,
        items: snapshot.items.map((item) => (item.id === itemId ? updated : item)),
      });
      return updated;
    },

    async deleteItem(itemId) {
      const snapshot = readOrEmpty();
      if (!snapshot.items.some((item) => item.id === itemId)) {
        throw new Error("Item not found.");
      }
      persistLocalSnapshot(userId, {
        projects: snapshot.projects,
        items: snapshot.items.filter((item) => item.id !== itemId),
      });
    },
  };
}
