/*
Design note for this file:
- Keep Hero fast and opinionated, but make the state layer honest about storage: demo, local fallback, or live Supabase.
- Preserve compact domain objects and shortcut-driven actions rather than introducing heavy app architecture.
- The web rebuild should support per-user hosted sync with simple email/password auth first, while remaining usable before external setup is finished.
*/
import { useCallback, useEffect, useMemo, useState } from "react";
import * as chrono from "chrono-node";
import { createClient, type Session } from "@supabase/supabase-js";

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

interface HeroSnapshot {
  projects: HeroProject[];
  items: HeroItem[];
}

interface UndoState {
  kind: "delete" | "done" | "create" | "update";
  item: HeroItem;
}

interface MutationResult {
  ok: boolean;
  message: string;
}

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  tone: ProjectTone;
  created_at: string;
}

interface ItemRow {
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

interface HeroPreferences {
  defaultProjectId?: string;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

// Single-attempt fetch with a 10s total timeout that covers headers AND body
// read. The timer stays armed after fetch() resolves so a stalled response
// body (Chrome's HTTP/2 half-dead symptom) also gets aborted — otherwise
// supabase-js's internal `.json()` can await forever and the outer await in
// saveDraft/updateItem never settles, which leaves captureSaving stuck true
// and the UI showing "Saving as …" indefinitely.
let supabaseFetchSeq = 0;
const supabaseFetch: typeof fetch = async (input, init) => {
  const reqId = ++supabaseFetchSeq;
  const method = (init?.method ?? "GET").toUpperCase();
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const startedAt = performance.now();
  const since = () => `${Math.round(performance.now() - startedAt)}ms`;
  console.log("[hero][fetch][req]", reqId, method, url);

  const externalSignal = init?.signal ?? null;
  if (externalSignal?.aborted) {
    console.warn("[hero][fetch][pre-aborted]", reqId, method, url);
    throw externalSignal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  setTimeout(() => {
    console.warn("[hero][fetch][timeout-fired]", reqId, since(), method, url);
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, 10000);
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    console.log("[hero][fetch][res]", reqId, response.status, since(), url);
    return response;
  } catch (err) {
    console.error("[hero][fetch][err]", reqId, since(), method, url, err);
    throw err;
  } finally {
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
};

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Disable Navigator LockManager coordination on the auth session.
          // After laptop sleep/wake in Chrome, the LockManager callback that
          // holds the "gotrue" lock can get suspended and never resumes, which
          // leaves the lock held indefinitely. Every subsequent data call goes
          // through fetchWithAuth → _getAccessToken → auth.getSession, all of
          // which try to acquire that same lock — and hang before any fetch is
          // issued. That's the stuck "Saving as …" state. A pass-through lock
          // removes the wedge entirely. The only thing we give up is cross-tab
          // coordination of token refreshes, which matters only if two tabs
          // are open concurrently; at worst they'd each do their own refresh.
          lock: (_name, _acquireTimeout, fn) => fn(),
        },
        global: {
          fetch: supabaseFetch,
        },
      })
    : null;

const orderedTones: ProjectTone[] = ["moss", "slate", "amber", "clay", "ink"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value?: string | null): value is string {
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

function createRecordId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return createUuidFallback();
}

function sanitizeProjectId(projectId?: string | null) {
  return isUuid(projectId) ? projectId : undefined;
}

function normalizeSnapshotIds(snapshot: HeroSnapshot): HeroSnapshot {
  const projectIdMap = new Map(
    snapshot.projects.map((project) => [project.id, isUuid(project.id) ? project.id : createRecordId()] as const),
  );
  const itemIdMap = new Map(
    snapshot.items.map((item) => [item.id, isUuid(item.id) ? item.id : createRecordId()] as const),
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
      ? itemIdMap.get(item.brokenDownFromId) ?? (isUuid(item.brokenDownFromId) ? item.brokenDownFromId : undefined)
      : undefined;

    if (nextId !== item.id || nextProjectId !== item.projectId || nextBrokenDownFromId !== item.brokenDownFromId) {
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

function ensureRemoteSafeProject(project: HeroProject): HeroProject {
  return isUuid(project.id) ? project : { ...project, id: createRecordId() };
}

function ensureRemoteSafeItem(item: HeroItem): HeroItem {
  return {
    ...item,
    id: isUuid(item.id) ? item.id : createRecordId(),
    projectId: sanitizeProjectId(item.projectId),
    brokenDownFromId: isUuid(item.brokenDownFromId) ? item.brokenDownFromId : undefined,
  };
}

function storageKey(userId: string) {
  return `hero-web::snapshot::${userId}`;
}

function preferencesKey(userId: string) {
  return `hero-web::prefs::${userId}`;
}

function readSerialized(userId: string): HeroSnapshot | null {
  const raw = window.localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    return normalizeSnapshotIds(JSON.parse(raw) as HeroSnapshot);
  } catch {
    return null;
  }
}

function persistSnapshot(userId: string, snapshot: HeroSnapshot) {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(snapshot));
}

function readPreferences(userId: string): HeroPreferences {
  const raw = window.localStorage.getItem(preferencesKey(userId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as HeroPreferences;
  } catch {
    return {};
  }
}

function persistPreferences(userId: string, preferences: HeroPreferences) {
  window.localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
}

function resolveDefaultProjectId(projects: HeroProject[], preferredProjectId?: string | null) {
  const preferred = sanitizeProjectId(preferredProjectId);
  if (preferred && projects.some((project) => project.id === preferred)) {
    return preferred;
  }

  return projects[0]?.id ?? null;
}

function createSeedProjects(): HeroProject[] {
  const now = new Date().toISOString();
  return [
    { id: createRecordId(), name: "Personal", tone: "moss", createdAt: now },
    { id: createRecordId(), name: "Work", tone: "slate", createdAt: now },
    { id: createRecordId(), name: "Reading", tone: "amber", createdAt: now },
  ];
}

function offset(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createSeedItems(projects: HeroProject[]): HeroItem[] {
  return [
    {
      id: createRecordId(),
      title: "Write the launch plan for Hero Web",
      type: "task",
      status: "upcoming",
      dueAt: offset(-2),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: projects[1]?.id,
      originalTitle: "Write the launch plan for Hero Web",
    },
    {
      id: createRecordId(),
      title: "Renew passport before summer travel",
      type: "task",
      status: "upcoming",
      dueAt: offset(18),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: projects[0]?.id,
      originalTitle: "Renew passport before summer travel",
    },
    {
      id: createRecordId(),
      title: "Read that essay on quiet software tools",
      type: "link",
      url: "https://example.com/quiet-tools",
      status: "upcoming",
      dueAt: offset(42),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: projects[2]?.id,
    },
    {
      id: createRecordId(),
      title: "Send proposal revision to Martina",
      type: "task",
      status: "done",
      dueAt: offset(-22),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: offset(-8),
      projectId: projects[1]?.id,
    },
  ];
}

function createSeedSnapshot(): HeroSnapshot {
  const projects = createSeedProjects();
  return {
    projects,
    items: createSeedItems(projects),
  };
}

function getDemoUser(): HeroUser {
  return {
    id: "demo-user",
    name: "Demo User",
    email: "demo@hero.local",
    mode: "demo",
  };
}

function getHeroTimeZone() {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("hero-timezone");
    if (stored) return stored;

    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTimeZone) {
      window.localStorage.setItem("hero-timezone", browserTimeZone);
      return browserTimeZone;
    }
  }

  return "UTC";
}

function getTimeZoneParts(
  date: Date,
  timeZone: string,
  weekday: "long" | "short" | undefined = undefined,
) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    ...(weekday ? { weekday } : {}),
  });

  const parts = formatter.formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";

  return {
    year: Number(valueFor("year")),
    month: Number(valueFor("month")),
    day: Number(valueFor("day")),
    hour: Number(valueFor("hour")),
    minute: Number(valueFor("minute")),
    second: Number(valueFor("second")),
    weekday: weekday ? valueFor("weekday") : "",
  };
}

function getReferenceDateForTimeZone(timeZone: string) {
  const now = getTimeZoneParts(new Date(), timeZone);
  return new Date(now.year, now.month - 1, now.day, now.hour, now.minute, now.second);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const zoned = getTimeZoneParts(date, timeZone);
  const zonedTimestamp = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  );

  return zonedTimestamp - date.getTime();
}

function wallClockDateToInstant(date: Date, timeZone: string) {
  const utcGuess = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );

  let resolved = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone));
  const refinedOffset = getTimeZoneOffsetMs(resolved, timeZone);
  resolved = new Date(utcGuess - refinedOffset);
  return resolved;
}

function withClock(date: Date, hour: number, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function hasExplicitClockTime(input: string) {
  return /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidnight\b/i.test(input);
}

function applyDaypartDefaults(matchText: string, parsedDate: Date, match: chrono.ParsedResult) {
  const lower = matchText.toLowerCase();
  if (hasExplicitClockTime(lower)) return parsedDate;
  if (match.start.isCertain("hour") || match.start.isCertain("minute")) return parsedDate;

  if (/\bmorning\b/.test(lower)) return withClock(parsedDate, 9);
  if (/\bafternoon\b/.test(lower)) return withClock(parsedDate, 15);
  if (/\bevening\b/.test(lower)) return withClock(parsedDate, 18);
  if (/\btonight\b/.test(lower)) return withClock(parsedDate, 20);

  return parsedDate;
}

function normalizeParsedDate(
  input: string,
  referenceDate = getReferenceDateForTimeZone(getHeroTimeZone()),
  timeZone = getHeroTimeZone(),
) {
  if (!input.trim()) return null;
  const [match] = chrono.parse(input, referenceDate, { forwardDate: true });
  if (!match) return null;

  const adjustedDate = applyDaypartDefaults(match.text, match.start.date(), match);
  return wallClockDateToInstant(adjustedDate, timeZone);
}

function humanTime(date: Date, timeZone = getHeroTimeZone()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function localDayNumber(date: Date, timeZone = getHeroTimeZone()) {
  const parts = getTimeZoneParts(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000;
}

export function getLocalDayKey(input: string | Date, timeZone = getHeroTimeZone()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = getTimeZoneParts(date, timeZone);
  const month = `${parts.month}`.padStart(2, "0");
  const day = `${parts.day}`.padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function diffLocalCalendarDays(target: Date, reference: Date, timeZone = getHeroTimeZone()) {
  return localDayNumber(target, timeZone) - localDayNumber(reference, timeZone);
}

function formatDueDate(date: Date, timeZone = getHeroTimeZone()) {
  const now = new Date();
  const diffDays = diffLocalCalendarDays(date, now, timeZone);

  if (diffDays === 0) {
    return `Today · ${humanTime(date, timeZone)}`;
  }
  if (diffDays === 1) {
    return `Tomorrow · ${humanTime(date, timeZone)}`;
  }
  if (diffDays === -1) {
    return `Yesterday · ${humanTime(date, timeZone)}`;
  }
  if (diffDays < 7 && diffDays > -7) {
    return `${getTimeZoneParts(date, timeZone, "long").weekday} · ${humanTime(date, timeZone)}`;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDueLabel(input: string) {
  return formatDueDate(new Date(input));
}

export function getDueMood(input: string) {
  const time = new Date(input).getTime();
  const delta = time - Date.now();
  if (delta < 0) return "overdue";
  if (delta < 1000 * 60 * 60 * 18) return "soon";
  return "later";
}

export function formatPreviewFromInput(input: string) {
  const timeZone = getHeroTimeZone();
  const parsed = normalizeParsedDate(input, getReferenceDateForTimeZone(timeZone), timeZone);
  if (!parsed) return "";

  return formatDueDate(parsed, timeZone)
    .replace("Today · ", "today at ")
    .replace("Tomorrow · ", "tomorrow at ")
    .replace("Yesterday · ", "yesterday at ")
    .replace(" · ", " at ");
}

export function parseCaptureInput(input: string): ParsedCaptureInput | null {
  const trimmed = collapseWhitespace(input);
  if (!trimmed) return null;

  const timeZone = getHeroTimeZone();
  const referenceDate = getReferenceDateForTimeZone(timeZone);
  const [match] = chrono.parse(trimmed, referenceDate, { forwardDate: true });
  if (!match) return null;

  const parsedDate = wallClockDateToInstant(applyDaypartDefaults(match.text, match.start.date(), match), timeZone);
  const title = collapseWhitespace(`${trimmed.slice(0, match.index)} ${trimmed.slice(match.index + match.text.length)}`);
  if (!title) return null;

  return {
    title,
    dueAt: parsedDate.toISOString(),
    matchedText: match.text,
  };
}

export function previewCaptureInput(input: string) {
  const parsed = parseCaptureInput(input);
  if (!parsed) return "";

  return `Wake up ${formatPreviewFromInput(parsed.matchedText)}.`;
}

function mapProjectRow(row: ProjectRow): HeroProject {
  return {
    id: row.id,
    name: row.name,
    tone: row.tone,
    createdAt: row.created_at,
  };
}

function mapItemRow(row: ItemRow): HeroItem {
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

function toProjectInsert(project: HeroProject, userId: string) {
  const safeProject = ensureRemoteSafeProject(project);

  return {
    user_id: userId,
    name: safeProject.name,
    tone: safeProject.tone,
    created_at: safeProject.createdAt,
  };
}

function toItemInsert(item: HeroItem, userId: string) {
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

function toItemPatch(patch: Partial<HeroItem>) {
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

async function getSupabaseUserFromSession(session: Session | null): Promise<HeroUser | null> {
  if (!session?.user) return null;
  return {
    id: session.user.id,
    name:
      session.user.user_metadata?.full_name ||
      session.user.user_metadata?.name ||
      session.user.email?.split("@")[0] ||
      "Hero User",
    email: session.user.email || "",
    avatarUrl: session.user.user_metadata?.avatar_url,
    mode: "supabase",
  };
}

async function loadRemoteSnapshot(userId: string): Promise<HeroSnapshot> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const [projectsResult, itemsResult] = await Promise.all([
    supabase.from("projects").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("items").select("*").eq("user_id", userId).order("due_at", { ascending: true }),
  ]);

  if (projectsResult.error) throw projectsResult.error;
  if (itemsResult.error) throw itemsResult.error;

  return {
    projects: (projectsResult.data as ProjectRow[]).map(mapProjectRow),
    items: (itemsResult.data as ItemRow[]).map(mapItemRow),
  };
}

function nextSelectedIdFromItems(nextItems: HeroItem[]) {
  return nextItems.find((item) => item.status === "upcoming")?.id ?? nextItems[0]?.id ?? null;
}

function collectDescendantIds(items: HeroItem[], parentId: string) {
  const descendants = new Set<string>();
  const queue = [parentId];

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) continue;

    items.forEach((item) => {
      if (item.brokenDownFromId === currentId && !descendants.has(item.id)) {
        descendants.add(item.id);
        queue.push(item.id);
      }
    });
  }

  return descendants;
}

function getSubtreeTailDueAt(items: HeroItem[], rootId: string) {
  const descendantIds = collectDescendantIds(items, rootId);
  const relevantIds = new Set([rootId, ...Array.from(descendantIds)]);

  return items
    .filter((item) => relevantIds.has(item.id))
    .reduce((latest, item) => {
      const current = new Date(item.dueAt).getTime();
      return current > latest ? current : latest;
    }, new Date().getTime());
}

export function useHeroApp() {
  const [user, setUser] = useState<HeroUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [projects, setProjects] = useState<HeroProject[]>([]);
  const [items, setItems] = useState<HeroItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultProjectId, setDefaultProjectIdState] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [remoteReady, setRemoteReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    supabase
      ? "Hosted sync is ready. Sign in with email and password to load your Hero workspace."
      : "Demo mode is active until Supabase keys are added.",
  );

  const applySnapshot = useCallback((snapshot: HeroSnapshot, userId: string, persistLocally = false) => {
    const resolvedDefaultProjectId = resolveDefaultProjectId(snapshot.projects, readPreferences(userId).defaultProjectId);
    setProjects(snapshot.projects);
    setItems(snapshot.items);
    setSelectedId(nextSelectedIdFromItems(snapshot.items));
    setDefaultProjectIdState(resolvedDefaultProjectId);
    if (persistLocally) {
      persistSnapshot(userId, snapshot);
      persistPreferences(userId, { defaultProjectId: resolvedDefaultProjectId ?? undefined });
    }
  }, []);

  const loadUserSnapshot = useCallback(
    async (nextUser: HeroUser) => {
      if (nextUser.mode === "demo") {
        const stored = readSerialized(nextUser.id) ?? createSeedSnapshot();
        if (!readSerialized(nextUser.id)) {
          persistSnapshot(nextUser.id, stored);
        }
        applySnapshot(stored, nextUser.id);
        setRemoteReady(false);
        setStatusMessage("Demo mode is active until Supabase keys are added.");
        return;
      }

      try {
        const remoteSnapshot = await loadRemoteSnapshot(nextUser.id);
        applySnapshot(remoteSnapshot, nextUser.id);
        setRemoteReady(true);
        setStatusMessage("Google sign-in and Supabase sync are live.");
      } catch {
        const localFallback = readSerialized(nextUser.id) ?? { projects: [], items: [] };
        applySnapshot(localFallback, nextUser.id, !readSerialized(nextUser.id));
        setRemoteReady(false);
        setStatusMessage(
          "Google sign-in is live, but database tables are not ready yet. Hero is using a private local fallback until the Supabase schema is applied.",
        );
      }
    },
    [applySnapshot],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe = () => undefined;

    async function bootstrap() {
      if (!supabase) {
        const demo = getDemoUser();
        if (!active) return;
        setUser(demo);
        await loadUserSnapshot(demo);
        if (!active) return;
        setAuthChecked(true);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const nextUser = await getSupabaseUserFromSession(data.session);
      if (!active) return;

      if (nextUser) {
        setUser(nextUser);
        await loadUserSnapshot(nextUser);
      }
      if (!active) return;
      setAuthChecked(true);

      const subscription = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log("[hero][auth]", event, session ? "hasSession" : "noSession");
        const changedUser = await getSupabaseUserFromSession(session);
        if (!active) return;

        if (!changedUser) {
          setUser(null);
          setProjects([]);
          setItems([]);
          setSelectedId(null);
          setDefaultProjectIdState(null);
          setRemoteReady(false);
          setStatusMessage("Signed out.");
          return;
        }

        setUser(changedUser);
        await loadUserSnapshot(changedUser);
      });

      unsubscribe = () => {
        subscription.data.subscription.unsubscribe();
      };
    }

    void bootstrap();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadUserSnapshot]);

  useEffect(() => {
    // On laptop sleep/wake, supabase-js's GoTrueClient can be left with a
    // stale internal lock: a pre-sleep operation sets `lockAcquired = true`
    // and/or pushes a promise onto `pendingInLock`, the underlying fetch gets
    // zombied during sleep and never settles, and every subsequent
    // auth.getSession() call queues behind that dead promise — so every
    // supabase.from().insert()/.update() that calls _getAccessToken hangs
    // forever *before* it ever hits our fetch wrapper. Our `lock` override
    // only replaces the outer navigator.locks call; it doesn't clear this
    // in-memory state. Forcibly reset it on each wake so the next save
    // enters the clean path.
    const resetAuthLockState = () => {
      if (!supabase) return;
      const auth = supabase.auth as unknown as {
        lockAcquired: boolean;
        pendingInLock: Promise<unknown>[];
      };
      if (auth.lockAcquired || (auth.pendingInLock && auth.pendingInLock.length > 0)) {
        console.warn(
          "[hero][auth] resetting stuck GoTrueClient lock state",
          { lockAcquired: auth.lockAcquired, pendingInLockLen: auth.pendingInLock?.length },
        );
      }
      auth.lockAcquired = false;
      auth.pendingInLock = [];
    };
    const onVisibility = () => {
      console.log("[hero][visibility]", document.visibilityState, "online:", navigator.onLine);
      if (document.visibilityState === "visible") resetAuthLockState();
    };
    const onOnline = () => {
      console.log("[hero][online]");
      resetAuthLockState();
    };
    const onOffline = () => console.log("[hero][offline]");
    const onPageShow = (event: PageTransitionEvent) => {
      console.log("[hero][pageshow] persisted:", event.persisted);
      if (event.persisted) resetAuthLockState();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const commitLocalSnapshot = useCallback(
    (nextProjects: HeroProject[], nextItems: HeroItem[], nextDefaultProjectId: string | null = defaultProjectId) => {
      const resolvedDefaultProjectId = resolveDefaultProjectId(nextProjects, nextDefaultProjectId);
      setProjects(nextProjects);
      setItems(nextItems);
      setSelectedId(nextSelectedIdFromItems(nextItems));
      setDefaultProjectIdState(resolvedDefaultProjectId);
      if (user) {
        persistSnapshot(user.id, { projects: nextProjects, items: nextItems });
        persistPreferences(user.id, { defaultProjectId: resolvedDefaultProjectId ?? undefined });
      }
    },
    [defaultProjectId, user],
  );

  const upcomingItems = useMemo(() => {
    return items
      .filter((item) => item.status === "upcoming")
      .filter((item) => activeProjectId === "all" || item.projectId === activeProjectId)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  }, [activeProjectId, items]);

  const doneItems = useMemo(() => {
    return items
      .filter((item) => item.status === "done")
      .sort(
        (a, b) =>
          new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime(),
      );
  }, [items]);

  const selectedIndex = useMemo(
    () => Math.max(0, upcomingItems.findIndex((item) => item.id === selectedId)),
    [selectedId, upcomingItems],
  );

  const selectedItem = upcomingItems[selectedIndex] ?? items.find((item) => item.id === selectedId) ?? null;
  const overdueCount = upcomingItems.filter((item) => new Date(item.dueAt).getTime() < Date.now()).length;
  const todayKey = getLocalDayKey(new Date());
  const doneTodayCount = doneItems.filter((item) => {
    const value = item.completedAt ? new Date(item.completedAt) : null;
    if (!value) return false;
    return getLocalDayKey(value) === todayKey;
  }).length;

  const dueNowItem = useMemo(
    () => upcomingItems.find((item) => new Date(item.dueAt).getTime() <= Date.now()) ?? null,
    [upcomingItems],
  );

  const addProject = useCallback(
    async (
      name: string,
      tone: ProjectTone = orderedTones[projects.length % orderedTones.length],
    ): Promise<MutationResult> => {
      if (!user || !name.trim()) return { ok: false, message: "Give the project a name first." };

      const nextProject: HeroProject = {
        id: createRecordId(),
        name: name.trim(),
        tone,
        createdAt: new Date().toISOString(),
      };

      if (user.mode === "demo" || !remoteReady || !supabase) {
        const nextProjects = [...projects, nextProject];
        commitLocalSnapshot(nextProjects, items, defaultProjectId ?? nextProject.id);
        setActiveProjectId(nextProject.id);
        return { ok: true, message: `Project “${nextProject.name}” added.` };
      }

      const result = await supabase.from("projects").insert(toProjectInsert(nextProject, user.id)).select().single();
      if (result.error) {
        return { ok: false, message: result.error.message };
      }

      const inserted = mapProjectRow(result.data as ProjectRow);
      setProjects((current) => [...current, inserted]);
      setActiveProjectId(inserted.id);
      if (!defaultProjectId) {
        setDefaultProjectIdState(inserted.id);
        persistPreferences(user.id, { defaultProjectId: inserted.id });
      }
      return { ok: true, message: `Project “${inserted.name}” added.` };
    },
    [commitLocalSnapshot, defaultProjectId, items, projects, remoteReady, user],
  );


  const saveDraft = useCallback(
    async (draft: CaptureDraft): Promise<MutationResult> => {
      console.log("[hero][saveDraft] entry", {
        hasUser: !!user,
        mode: user?.mode,
        remoteReady,
        hasSupabase: !!supabase,
      });
      if (!user) return { ok: false, message: "Please sign in first." };

      let nextTitle = draft.title.trim();
      let nextDueAt = "";

      if (draft.captureInput?.trim()) {
        const parsedCapture = parseCaptureInput(draft.captureInput);
        if (!parsedCapture) {
          return {
            ok: false,
            message: "Type the task together with a wake-up time, like “follow up with Maya tomorrow 9am”.",
          };
        }
        nextTitle = parsedCapture.title;
        nextDueAt = parsedCapture.dueAt;
      } else {
        const parsed = normalizeParsedDate(draft.dueInput);
        if (!parsed) return { ok: false, message: "Hero could not interpret that reminder time." };
        nextDueAt = parsed.toISOString();
      }

      if (!nextTitle) return { ok: false, message: "Give the item a title before saving." };
      if (draft.type === "link" && draft.url && !/^https?:\/\//.test(draft.url)) {
        return { ok: false, message: "Link items should use a full https:// URL." };
      }

      const now = new Date().toISOString();
      const nextProjectId = sanitizeProjectId(draft.projectId) ?? resolveDefaultProjectId(projects, defaultProjectId) ?? undefined;
      const next: HeroItem = {
        id: createRecordId(),
        title: nextTitle,
        type: draft.type,
        status: "upcoming",
        dueAt: nextDueAt,
        createdAt: now,
        updatedAt: now,
        url: draft.type === "link" ? draft.url?.trim() : undefined,
        projectId: nextProjectId,
        isRecurringDaily: draft.isRecurringDaily,
        originalTitle: draft.type === "task" ? nextTitle : undefined,
      };

      if (user.mode === "demo" || !remoteReady || !supabase) {
        console.log("[hero][saveDraft] local path");
        const nextItems = [...items, next];
        commitLocalSnapshot(projects, nextItems);
        setSelectedId(next.id);
        setUndoState({ kind: "create", item: next });
        setComposerOpen(false);
        return { ok: true, message: `Saved for ${formatDueLabel(next.dueAt)}.` };
      }

      console.log("[hero][saveDraft] before supabase.insert", { id: next.id });
      const result = await supabase.from("items").insert(toItemInsert(next, user.id)).select().single();
      console.log("[hero][saveDraft] after supabase.insert", {
        ok: !result.error,
        errorMessage: result.error?.message,
        errorCode: result.error?.code,
      });
      if (result.error) {
        return { ok: false, message: result.error.message };
      }

      const inserted = mapItemRow(result.data as ItemRow);
      setItems((current) => [...current, inserted]);
      setSelectedId(inserted.id);
      setUndoState({ kind: "create", item: inserted });
      setComposerOpen(false);
      return { ok: true, message: `Saved for ${formatDueLabel(inserted.dueAt)}.` };
    },
    [commitLocalSnapshot, defaultProjectId, items, projects, remoteReady, user],
  );

  const updateItem = useCallback(
    async (itemId: string, patch: Partial<HeroItem>): Promise<MutationResult> => {
      const nextUpdatedAt = new Date().toISOString();
      if (user?.mode === "demo" || !remoteReady || !supabase) {
        const nextItems = items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                ...patch,
                updatedAt: patch.updatedAt ?? nextUpdatedAt,
              }
            : item,
        );
        commitLocalSnapshot(projects, nextItems);
        return { ok: true, message: "Item updated." };
      }

      if (!user) return { ok: false, message: "Please sign in first." };
      const result = await supabase
        .from("items")
        .update(toItemPatch({ ...patch, updatedAt: patch.updatedAt ?? nextUpdatedAt }))
        .eq("id", itemId)
        .eq("user_id", user.id)
        .select()
        .single();

      if (result.error) {
        return { ok: false, message: result.error.message };
      }

      const updated = mapItemRow(result.data as ItemRow);
      setItems((current) => current.map((item) => (item.id === itemId ? updated : item)));
      return { ok: true, message: "Item updated." };
    },
    [commitLocalSnapshot, defaultProjectId, items, projects, remoteReady, user],
  );

  const renameItem = useCallback(
    async (itemId: string, title: string, projectId?: string): Promise<MutationResult> => {
      if (!title.trim()) return { ok: false, message: "Give the item a title first." };
      const target = items.find((item) => item.id === itemId);
      if (!target) return { ok: false, message: "Item not found." };
      const result = await updateItem(itemId, {
        title: title.trim(),
        projectId: sanitizeProjectId(projectId) ?? resolveDefaultProjectId(projects, defaultProjectId) ?? undefined,
      });
      if (!result.ok) return result;
      setUndoState({ kind: "update", item: target });
      return result;
    },
    [defaultProjectId, items, projects, updateItem],
  );

  const rescheduleItem = useCallback(
    async (itemId: string, dueInput: string): Promise<MutationResult> => {
      const target = items.find((item) => item.id === itemId);
      if (!target) return { ok: false, message: "Item not found." };
      const parsed = normalizeParsedDate(dueInput);
      if (!parsed) return { ok: false, message: "Could not interpret the new reminder time." };
      const result = await updateItem(itemId, { dueAt: parsed.toISOString() });
      if (!result.ok) return result;
      setUndoState({ kind: "update", item: target });
      return { ok: true, message: `Rescheduled to ${formatDueLabel(parsed.toISOString())}.` };
    },
    [items, updateItem],
  );

  const editCapture = useCallback(
    async (itemId: string, rawInput: string, projectId?: string): Promise<MutationResult> => {
      const trimmed = rawInput.trim();
      if (!trimmed) return { ok: false, message: "Give the item a title first." };
      const target = items.find((item) => item.id === itemId);
      if (!target) return { ok: false, message: "Item not found." };

      const parsed = parseCaptureInput(trimmed);
      const resolvedProjectId =
        sanitizeProjectId(projectId) ?? resolveDefaultProjectId(projects, defaultProjectId) ?? undefined;

      const patch: Partial<HeroItem> = { projectId: resolvedProjectId };
      if (parsed) {
        patch.title = parsed.title;
        patch.dueAt = parsed.dueAt;
      } else {
        patch.title = trimmed;
      }

      const unchanged =
        patch.title === target.title &&
        (patch.dueAt ?? target.dueAt) === target.dueAt &&
        (patch.projectId ?? target.projectId) === target.projectId;
      if (unchanged) {
        return { ok: true, message: "No changes." };
      }

      const result = await updateItem(itemId, patch);
      if (!result.ok) return result;
      setUndoState({ kind: "update", item: target });
      return {
        ok: true,
        message: parsed && patch.dueAt !== target.dueAt
          ? `Updated and rescheduled to ${formatDueLabel(patch.dueAt!)}.`
          : "Item updated.",
      };
    },
    [defaultProjectId, items, projects, updateItem],
  );

  const markDone = useCallback(
    async (itemId: string): Promise<MutationResult> => {
      const target = items.find((item) => item.id === itemId);
      if (!target) return { ok: false, message: "Item not found." };
      const completedAt = new Date().toISOString();
      const result = await updateItem(itemId, {
        status: "done",
        completedAt,
        updatedAt: completedAt,
      });
      if (!result.ok) return result;
      setUndoState({ kind: "done", item: target });
      const nextUpcoming = upcomingItems.filter((item) => item.id !== itemId);
      setSelectedId(nextUpcoming[0]?.id ?? null);
      return { ok: true, message: "Item marked done." };
    },
    [items, upcomingItems, updateItem],
  );

  const toggleStar = useCallback(
    async (itemId: string): Promise<MutationResult> => {
      const target = items.find((item) => item.id === itemId);
      if (!target) return { ok: false, message: "Item not found." };

      const willStar = !target.isStarred;
      if (willStar) {
        const starredCount = items.filter(
          (item) => item.isStarred && item.status === "upcoming" && item.id !== itemId,
        ).length;
        if (starredCount >= MAX_STARRED_TASKS) {
          return {
            ok: false,
            message: `You can star at most ${MAX_STARRED_TASKS} tasks. Unstar one first.`,
          };
        }
      }

      const result = await updateItem(itemId, { isStarred: willStar });
      if (!result.ok) return result;
      setUndoState({ kind: "update", item: target });
      return { ok: true, message: willStar ? "Task starred." : "Star removed." };
    },
    [items, updateItem],
  );

  const removeItem = useCallback(
    async (itemId: string): Promise<MutationResult> => {
      const target = items.find((item) => item.id === itemId);
      if (!target) return { ok: false, message: "Item not found." };

      if (user?.mode === "demo" || !remoteReady || !supabase) {
        const nextItems = items.filter((item) => item.id !== itemId);
        commitLocalSnapshot(projects, nextItems);
        setUndoState({ kind: "delete", item: target });
        return { ok: true, message: "Item deleted." };
      }

      if (!user) return { ok: false, message: "Please sign in first." };
      const result = await supabase.from("items").delete().eq("id", itemId).eq("user_id", user.id);
      if (result.error) {
        return { ok: false, message: result.error.message };
      }

      setItems((current) => current.filter((item) => item.id !== itemId));
      setUndoState({ kind: "delete", item: target });
      const nextUpcoming = upcomingItems.filter((item) => item.id !== itemId);
      setSelectedId(nextUpcoming[0]?.id ?? null);
      return { ok: true, message: "Item deleted." };
    },
    [commitLocalSnapshot, items, projects, remoteReady, upcomingItems, user],
  );

  const undoLastAction = useCallback(async (): Promise<MutationResult> => {
    if (!undoState) return { ok: false, message: "Nothing to undo." };

    if (undoState.kind === "delete") {
      const restored = undoState.item;
      if (user?.mode === "demo" || !remoteReady || !supabase) {
        const nextItems = [...items, restored].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        commitLocalSnapshot(projects, nextItems);
        setSelectedId(restored.id);
        setUndoState(null);
        return { ok: true, message: "Deletion undone." };
      }

      if (!user) return { ok: false, message: "Please sign in first." };
      const result = await supabase.from("items").insert(toItemInsert(restored, user.id)).select().single();
      if (result.error) return { ok: false, message: result.error.message };

      const inserted = mapItemRow(result.data as ItemRow);
      setItems((current) => [...current, inserted].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
      setSelectedId(inserted.id);
      setUndoState(null);
      return { ok: true, message: "Deletion undone." };
    }

    if (undoState.kind === "create") {
      const created = undoState.item;
      if (user?.mode === "demo" || !remoteReady || !supabase) {
        const nextItems = items.filter((item) => item.id !== created.id);
        commitLocalSnapshot(projects, nextItems);
        setUndoState(null);
        return { ok: true, message: "Creation undone." };
      }

      if (!user) return { ok: false, message: "Please sign in first." };
      const result = await supabase.from("items").delete().eq("id", created.id).eq("user_id", user.id);
      if (result.error) return { ok: false, message: result.error.message };

      setItems((current) => current.filter((item) => item.id !== created.id));
      setUndoState(null);
      return { ok: true, message: "Creation undone." };
    }

    const restored = undoState.item;
    const result = await updateItem(restored.id, {
      title: restored.title,
      type: restored.type,
      status: restored.status,
      dueAt: restored.dueAt,
      createdAt: restored.createdAt,
      updatedAt: restored.updatedAt,
      completedAt: restored.completedAt,
      url: restored.url,
      projectId: restored.projectId,
      isRecurringDaily: restored.isRecurringDaily,
      isStarred: restored.isStarred,
      brokenDownFromId: restored.brokenDownFromId,
      originalTitle: restored.originalTitle,
    });
    if (!result.ok) return result;
    setSelectedId(restored.id);
    setUndoState(null);
    return { ok: true, message: undoState.kind === "done" ? "Completion undone." : "Change undone." };
  }, [commitLocalSnapshot, items, projects, remoteReady, undoState, updateItem, user]);

  const breakDownAndResnooze = useCallback(
    async (itemId: string, smallerStep: string, dueInput: string): Promise<MutationResult> => {
      const target = items.find((item) => item.id === itemId);
      const parsed = normalizeParsedDate(dueInput);
      if (!target || !parsed) {
        return { ok: false, message: "Hero needs both a smaller step and a valid reminder time." };
      }
      const nextTitle = smallerStep.trim() || target.title;
      const result = await updateItem(itemId, {
        title: nextTitle,
        dueAt: parsed.toISOString(),
        brokenDownFromId: target.brokenDownFromId || target.id,
        originalTitle: target.originalTitle || target.title,
      });
      if (!result.ok) return result;
      setUndoState({ kind: "update", item: target });
      return { ok: true, message: `Smaller next step scheduled for ${formatDueLabel(parsed.toISOString())}.` };
    },
    [items, updateItem],
  );

  const updateProject = useCallback(
    async (projectId: string, patch: Partial<Pick<HeroProject, "name" | "tone">>): Promise<MutationResult> => {
      const target = projects.find((project) => project.id === projectId);
      if (!target) return { ok: false, message: "Project not found." };

      const nextName = patch.name?.trim() ?? target.name;
      const nextTone = patch.tone ?? target.tone;
      if (!nextName) return { ok: false, message: "Give the project a name first." };

      if (user?.mode === "demo" || !remoteReady || !supabase) {
        const nextProjects = projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                name: nextName,
                tone: nextTone,
              }
            : project,
        );
        commitLocalSnapshot(nextProjects, items);
        return { ok: true, message: "Project updated." };
      }

      if (!user) return { ok: false, message: "Please sign in first." };
      const result = await supabase
        .from("projects")
        .update({ name: nextName, tone: nextTone })
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select()
        .single();

      if (result.error) {
        return { ok: false, message: result.error.message };
      }

      const updated = mapProjectRow(result.data as ProjectRow);
      setProjects((current) => current.map((project) => (project.id === projectId ? updated : project)));
      return { ok: true, message: "Project updated." };
    },
    [commitLocalSnapshot, items, projects, remoteReady, user],
  );

  const setDefaultProject = useCallback(
    async (projectId: string): Promise<MutationResult> => {
      if (!user) return { ok: false, message: "Please sign in first." };
      const target = projects.find((project) => project.id === projectId);
      if (!target) return { ok: false, message: "Project not found." };
      setDefaultProjectIdState(projectId);
      persistPreferences(user.id, { defaultProjectId: projectId });
      return { ok: true, message: `Default project set to “${target.name}”.` };
    },
    [projects, user],
  );

  const moveItem = useCallback(
    async (itemId: string, targetId: string, mode: "after" | "chain"): Promise<MutationResult> => {
      const source = items.find((item) => item.id === itemId);
      const target = items.find((item) => item.id === targetId);

      if (!source || !target) {
        return { ok: false, message: "Hero could not find that task to move." };
      }

      if (source.id === target.id) {
        return { ok: false, message: "Choose a different task as the drop target." };
      }

      const sourceDescendants = collectDescendantIds(items, source.id);
      if (sourceDescendants.has(target.id)) {
        return { ok: false, message: "A task cannot be dropped inside its own chain." };
      }

      const nextDueAt = new Date(getSubtreeTailDueAt(items, target.id) + 60_000).toISOString();
      const nextParentId = mode === "chain" ? target.id : target.brokenDownFromId;
      const result = await updateItem(itemId, {
        dueAt: nextDueAt,
        brokenDownFromId: nextParentId,
      });

      if (!result.ok) return result;
      setUndoState({ kind: "update", item: source });
      return {
        ok: true,
        message: mode === "chain" ? `Chained under “${target.title}”.` : `Moved after “${target.title}”.`,
      };
    },
    [items, updateItem],
  );

  const signIn = useCallback(async (): Promise<MutationResult> => {
    if (!supabase) {
      const demo = getDemoUser();
      setUser(demo);
      await loadUserSnapshot(demo);
      setAuthChecked(true);
      return { ok: true, message: "Signed into demo mode." };
    }

    return {
      ok: false,
      message: "Use email and password to sign in to the hosted workspace.",
    };
  }, [loadUserSnapshot]);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<MutationResult> => {
      if (!supabase) {
        const demo = getDemoUser();
        setUser(demo);
        await loadUserSnapshot(demo);
        setAuthChecked(true);
        return { ok: true, message: "Signed into demo mode." };
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !password.trim()) {
        return { ok: false, message: "Enter both email and password." };
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        return { ok: false, message: error.message };
      }

      return { ok: true, message: "Signed in." };
    },
    [loadUserSnapshot],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string): Promise<MutationResult> => {
      if (!supabase) {
        const demo = getDemoUser();
        setUser(demo);
        await loadUserSnapshot(demo);
        setAuthChecked(true);
        return { ok: true, message: "Signed into demo mode." };
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !password.trim()) {
        return { ok: false, message: "Enter both email and password." };
      }

      if (password.trim().length < 8) {
        return { ok: false, message: "Use at least 8 characters for the password." };
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        return { ok: false, message: error.message };
      }

      if (data.session) {
        return { ok: true, message: "Account created and signed in." };
      }

      return {
        ok: true,
        message: "Account created. Check your email if confirmation is enabled.",
      };
    },
    [loadUserSnapshot],
  );

  const signOut = useCallback(async () => {
    if (!supabase || user?.mode === "demo") {
      setUser(null);
      setProjects([]);
      setItems([]);
      setSelectedId(null);
      setRemoteReady(false);
      return;
    }
    await supabase.auth.signOut();
  }, [user?.mode]);

  const streak = useMemo(() => {
    const dates = new Set(
      doneItems
        .map((item) => (item.completedAt ? getLocalDayKey(item.completedAt) : null))
        .filter(Boolean) as string[],
    );
    let count = 0;
    const cursor = new Date();
    while (dates.has(getLocalDayKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }, [doneItems]);

  const projectOptions = useMemo(
    () => [{ id: "all", name: "All projects", tone: "ink" as ProjectTone }, ...projects],
    [projects],
  );

  return {
    activeProjectId,
    authChecked,
    composerOpen,
    defaultProjectId,
    doneItems,
    doneTodayCount,
    dueNowItem,
    items,
    legacyShortcutHints,
    overdueCount,
    projectOptions,
    projects,
    remoteReady,
    selectedId,
    selectedIndex,
    selectedItem,
    statusMessage,
    streak,
    upcomingItems,
    undoState,
    user,
    setActiveProjectId,
    setComposerOpen,
    setSelectedId,
    addProject,
    breakDownAndResnooze,
    editCapture,
    formatPreviewFromInput,
    markDone,
    moveItem,
    parseCaptureInput,
    previewCaptureInput,
    removeItem,
    renameItem,
    rescheduleItem,
    saveDraft,
    setDefaultProject,
    signIn,
    signInWithPassword,
    signOut,
    signUpWithPassword,
    toggleStar,
    undoLastAction,
    updateProject,
  };
}
