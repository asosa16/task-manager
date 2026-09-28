/*
Design note for this file:
- Hosts every type, constant, and pure helper that both the local and remote Task Man stores need.
- Pure and side-effect free: no I/O, no React, no Supabase client. Safe to import from anywhere.
- Centralizes the domain↔row marshaling so the local store and the remote store can't drift.
*/

export type ProjectTone = "moss" | "slate" | "amber" | "clay" | "ink";
export type HeroItemType = "task" | "link";
export type HeroStatus = "upcoming" | "done";

export interface HeroProject {
  id: string;
  name: string;
  tone: ProjectTone;
  createdAt: string;
}

export interface HeroItem {
  id: string;
  title: string;
  type: HeroItemType;
  status: HeroStatus;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  url?: string;
  projectId?: string;
  isRecurringDaily?: boolean;
  isStarred?: boolean;
  brokenDownFromId?: string;
  originalTitle?: string;
}

export const MAX_STARRED_TASKS = 3;

export interface HeroUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  mode: "demo" | "supabase";
}

export interface CaptureDraft {
  title: string;
  dueInput: string;
  captureInput?: string;
  projectId?: string;
  type: HeroItemType;
  url?: string;
  isRecurringDaily?: boolean;
}

export interface ParsedCaptureInput {
  title: string;
  dueAt: string;
  matchedText: string;
}

export interface HeroSnapshot {
  projects: HeroProject[];
  items: HeroItem[];
}

export interface UndoState {
  kind: "delete" | "done" | "create" | "update";
  item: HeroItem;
}

export interface MutationResult {
  ok: boolean;
  message: string;
}

export interface HeroPreferences {
  defaultProjectId?: string;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  tone: ProjectTone;
  created_at: string;
}

export interface ItemRow {
  id: string;
  user_id: string;
  title: string;
  type: HeroItemType;
  status: HeroStatus;
  due_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  url: string | null;
  project_id: string | null;
  is_recurring_daily: boolean;
  is_starred: boolean | null;
  broken_down_from_id: string | null;
  original_title: string | null;
}

/**
 * The contract both stores implement. Each method throws on failure; callers
 * in useHeroApp wrap the call in try/catch and surface a MutationResult.
 * The local store reads and writes localStorage; the remote store issues
 * PostgREST fetches. Neither touches React state — that stays in the hook.
 */
export interface HeroStore {
  loadSnapshot(): Promise<HeroSnapshot>;
  insertProject(project: HeroProject): Promise<HeroProject>;
  updateProject(
    projectId: string,
    patch: Partial<Pick<HeroProject, "name" | "tone">>,
  ): Promise<HeroProject>;
  insertItem(item: HeroItem): Promise<HeroItem>;
  updateItem(itemId: string, patch: Partial<HeroItem>): Promise<HeroItem>;
  deleteItem(itemId: string): Promise<void>;
}

/**
 * Thrown by the remote store when PostgREST returns 42P01 (undefined_table).
 * The bootstrap effect in useHeroApp catches this and swaps to the local
 * store so the app keeps working with the "database tables are not ready"
 * banner instead of hanging on every mutation.
 */
export class SchemaMissingError extends Error {
  constructor(message = "Supabase tables are not yet applied for this user.") {
    super(message);
    this.name = "SchemaMissingError";
  }
}

/**
 * Thrown by the remote store for any PostgREST response it could not accept,
 * carrying the HTTP status (and Postgres error code when present) so the
 * synced store's outbox can tell "retry later" (5xx, 401, 429, network) apart
 * from "this write can never succeed" (404 row gone, 409 duplicate, 4xx).
 */
export class PostgrestRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PostgrestRequestError";
    this.status = status;
    this.code = code;
  }
}

export const legacyShortcutHints = [
  { key: "N", description: "Quick add" },
  { key: "J / K", description: "Move focus" },
  { key: "D", description: "Mark selected done" },
  { key: "Delete", description: "Delete selected" },
  { key: "Shift + E", description: "Edit selected item" },
  { key: "Z / U", description: "Undo last action" },
];

export const toneClassMap: Record<ProjectTone, string> = {
  moss: "bg-white text-black border-black/20",
  slate: "bg-[#efefef] text-black border-black/15",
  amber: "bg-[#dcdcdc] text-black border-black/15",
  clay: "bg-[#cfcfcf] text-black border-black/15",
  ink: "bg-black text-white border-black",
};

export const toneColorMap: Record<ProjectTone, string> = {
  moss: "#5b8c5a",
  slate: "#4f6d8a",
  amber: "#c58b1c",
  clay: "#b86464",
  ink: "#111111",
};

export const toneLabelMap: Record<ProjectTone, string> = {
  moss: "Green",
  slate: "Blue",
  amber: "Gold",
  clay: "Rose",
  ink: "Black",
};

export const orderedTones: ProjectTone[] = ["moss", "slate", "amber", "clay", "ink"];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value?: string | null): value is string {
  return Boolean(value && uuidPattern.test(value));
}

function createUuidFallback() {
  const bytes = new Uint8Array(16);

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createRecordId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return createUuidFallback();
}

export function sanitizeProjectId(projectId?: string | null) {
  return isUuid(projectId) ? projectId : undefined;
}

/**
 * Walks a snapshot and rewrites any non-UUID ids to fresh UUIDs (projects,
 * items, and the projectId / brokenDownFromId references that point at them).
 * Pre-Supabase demo snapshots used nanoid-style ids; without this, a user
 * who demoed before signing in would hit `invalid input syntax for type uuid`
 * on every write. Runs on every localStorage read.
 */
export function normalizeSnapshotIds(snapshot: HeroSnapshot): HeroSnapshot {
  const projectIdMap = new Map(
    snapshot.projects.map(
      (project) => [project.id, isUuid(project.id) ? project.id : createRecordId()] as const,
    ),
  );
  const itemIdMap = new Map(
    snapshot.items.map(
      (item) => [item.id, isUuid(item.id) ? item.id : createRecordId()] as const,
    ),
  );

  let changed = false;

  const projects = snapshot.projects.map((project) => {
    const nextId = projectIdMap.get(project.id) ?? project.id;
    if (nextId !== project.id) changed = true;
    return nextId === project.id ? project : { ...project, id: nextId };
  });

  const items = snapshot.items.map((item) => {
    const nextId = itemIdMap.get(item.id) ?? item.id;
    const nextProjectId = item.projectId
      ? projectIdMap.get(item.projectId) ?? sanitizeProjectId(item.projectId)
      : undefined;
    const nextBrokenDownFromId = item.brokenDownFromId
      ? itemIdMap.get(item.brokenDownFromId) ??
        (isUuid(item.brokenDownFromId) ? item.brokenDownFromId : undefined)
      : undefined;

    if (
      nextId !== item.id ||
      nextProjectId !== item.projectId ||
      nextBrokenDownFromId !== item.brokenDownFromId
    ) {
      changed = true;
    }

    return {
      ...item,
      id: nextId,
      projectId: nextProjectId,
      brokenDownFromId: nextBrokenDownFromId,
    };
  });

  return changed ? { projects, items } : snapshot;
}

export function ensureRemoteSafeProject(project: HeroProject): HeroProject {
  return isUuid(project.id) ? project : { ...project, id: createRecordId() };
}

export function ensureRemoteSafeItem(item: HeroItem): HeroItem {
  return {
    ...item,
    id: isUuid(item.id) ? item.id : createRecordId(),
    projectId: sanitizeProjectId(item.projectId),
    brokenDownFromId: isUuid(item.brokenDownFromId) ? item.brokenDownFromId : undefined,
  };
}

export function mapProjectRow(row: ProjectRow): HeroProject {
  return {
    id: row.id,
    name: row.name,
    tone: row.tone,
    createdAt: row.created_at,
  };
}

export function mapItemRow(row: ItemRow): HeroItem {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    url: row.url ?? undefined,
    projectId: row.project_id ?? undefined,
    isRecurringDaily: row.is_recurring_daily,
    isStarred: row.is_starred ?? false,
    brokenDownFromId: row.broken_down_from_id ?? undefined,
    originalTitle: row.original_title ?? undefined,
  };
}

export function toProjectInsert(project: HeroProject, userId: string) {
  const safeProject = ensureRemoteSafeProject(project);

  return {
    id: safeProject.id,
    user_id: userId,
    name: safeProject.name,
    tone: safeProject.tone,
    created_at: safeProject.createdAt,
  };
}

export function toItemInsert(item: HeroItem, userId: string) {
  const safeItem = ensureRemoteSafeItem(item);

  return {
    id: safeItem.id,
    user_id: userId,
    title: safeItem.title,
    type: safeItem.type,
    status: safeItem.status,
    due_at: safeItem.dueAt,
    created_at: safeItem.createdAt,
    updated_at: safeItem.updatedAt,
    completed_at: safeItem.completedAt ?? null,
    url: safeItem.url ?? null,
    project_id: safeItem.projectId ?? null,
    is_recurring_daily: safeItem.isRecurringDaily ?? false,
    is_starred: safeItem.isStarred ?? false,
    broken_down_from_id: safeItem.brokenDownFromId ?? null,
    original_title: safeItem.originalTitle ?? null,
  };
}

export function toItemPatch(patch: Partial<HeroItem>) {
  const mapped: Record<string, unknown> = {};

  if (patch.title !== undefined) mapped.title = patch.title;
  if (patch.type !== undefined) mapped.type = patch.type;
  if (patch.status !== undefined) mapped.status = patch.status;
  if (patch.dueAt !== undefined) mapped.due_at = patch.dueAt;
  if (patch.createdAt !== undefined) mapped.created_at = patch.createdAt;
  if (patch.updatedAt !== undefined) mapped.updated_at = patch.updatedAt;
  if (patch.completedAt !== undefined) mapped.completed_at = patch.completedAt ?? null;
  if (patch.url !== undefined) mapped.url = patch.url ?? null;
  if (patch.projectId !== undefined) mapped.project_id = sanitizeProjectId(patch.projectId) ?? null;
  if (patch.isRecurringDaily !== undefined) mapped.is_recurring_daily = patch.isRecurringDaily;
  if (patch.isStarred !== undefined) mapped.is_starred = patch.isStarred ?? false;
  if (patch.brokenDownFromId !== undefined) {
    mapped.broken_down_from_id = isUuid(patch.brokenDownFromId) ? patch.brokenDownFromId : null;
  }
  if (patch.originalTitle !== undefined) mapped.original_title = patch.originalTitle ?? null;

  return mapped;
}
