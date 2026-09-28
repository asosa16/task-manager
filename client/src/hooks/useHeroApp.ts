/*
Design note for this file:
- Keep Task Man fast and opinionated, but make the state layer honest about storage: demo, local fallback, or live Supabase.
- Preserve compact domain objects and shortcut-driven actions rather than introducing heavy app architecture.
- The web rebuild should support per-user hosted sync with email magic link auth, while remaining usable before external setup is finished.
- Live mode is local-first: mutations hit the synced store (memory + localStorage) and resolve instantly; the Supabase write happens in a background outbox. The hook never waits on the network after boot.
*/
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as chrono from "chrono-node";
import { toast } from "sonner";
import { type Session } from "@supabase/supabase-js";

import {
  getAccessToken,
  getInitialSession,
  onAuthChange,
  sendMagicLink as authSendMagicLink,
  signOut as authSignOut,
  supabaseConfigured,
} from "@/lib/heroAuth";

import {
  MAX_STARRED_TASKS,
  SchemaMissingError,
  createRecordId,
  legacyShortcutHints,
  orderedTones,
  sanitizeProjectId,
  toneClassMap,
  toneColorMap,
  toneLabelMap,
  type CaptureDraft,
  type HeroItem,
  type HeroItemType,
  type HeroProject,
  type HeroSnapshot,
  type HeroStatus,
  type HeroStore,
  type HeroUser,
  type MutationResult,
  type ParsedCaptureInput,
  type ProjectTone,
  type UndoState,
} from "@/lib/heroStore.types";
import {
  createLocalStore,
  createSeedSnapshot,
  getDemoUser,
  persistLocalSnapshot,
  persistPreferences,
  readLocalSnapshot,
  readPreferences,
} from "@/lib/heroStore.local";
import { createRemoteStore } from "@/lib/heroStore.remote";
import { createSyncedStore, type SyncStatus, type SyncedStore } from "@/lib/heroStore.synced";

export {
  MAX_STARRED_TASKS,
  legacyShortcutHints,
  toneClassMap,
  toneColorMap,
  toneLabelMap,
  type CaptureDraft,
  type HeroItem,
  type HeroItemType,
  type HeroProject,
  type HeroStatus,
  type HeroUser,
  type ParsedCaptureInput,
  type ProjectTone,
  type SyncStatus,
};

function resolveDefaultProjectId(projects: HeroProject[], preferredProjectId?: string | null) {
  const preferred = sanitizeProjectId(preferredProjectId);
  if (preferred && projects.some((project) => project.id === preferred)) {
    return preferred;
  }

  return projects[0]?.id ?? null;
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

async function getSupabaseUserFromSession(session: Session | null): Promise<HeroUser | null> {
  if (!session?.user) return null;
  return {
    id: session.user.id,
    name:
      session.user.user_metadata?.full_name ||
      session.user.user_metadata?.name ||
      session.user.email?.split("@")[0] ||
      "Task Man User",
    email: session.user.email || "",
    avatarUrl: session.user.user_metadata?.avatar_url,
    mode: "supabase",
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>(
    supabaseConfigured
      ? "Hosted sync is ready. Sign in with an email magic link to load your Task Man workspace."
      : "Demo mode is active until Supabase keys are added.",
  );

  // The active HeroStore: local for demo or fallback, remote for live. Swapped
  // inside loadUserSnapshot based on mode, read by every mutation. Kept in a
  // ref rather than state because the store change is always paired with an
  // applySnapshot/setProjects/setItems that already triggers a re-render.
  const storeRef = useRef<HeroStore | null>(null);
  // The live-mode synced store, kept separately so it can be disposed (timers,
  // focus/online listeners) when the user changes or signs out.
  const syncedRef = useRef<SyncedStore | null>(null);
  // Which user the live synced store belongs to. supabase-js fires SIGNED_IN on
  // every tab-visible and TOKEN_REFRESHED after each refresh; rebuilding the
  // store for those would reset selection and race the old store's in-flight
  // sync against the new one, so same-user events are ignored.
  const syncedUserIdRef = useRef<string | null>(null);
  // Bumped on every loadUserSnapshot call. Auth events aren't awaited, so two
  // loads can overlap; only the newest may install its store, and the loser
  // disposes its own instead of leaking a second store that keeps publishing.
  const loadGenerationRef = useRef(0);

  const disposeSynced = useCallback(() => {
    syncedRef.current?.dispose();
    syncedRef.current = null;
    syncedUserIdRef.current = null;
    setSyncStatus("idle");
  }, []);

  const applySnapshot = useCallback((snapshot: HeroSnapshot, userId: string, persistLocally = false) => {
    const resolvedDefaultProjectId = resolveDefaultProjectId(snapshot.projects, readPreferences(userId).defaultProjectId);
    setProjects(snapshot.projects);
    setItems(snapshot.items);
    setSelectedId(nextSelectedIdFromItems(snapshot.items));
    setDefaultProjectIdState(resolvedDefaultProjectId);
    if (persistLocally) {
      persistLocalSnapshot(userId, snapshot);
      persistPreferences(userId, { defaultProjectId: resolvedDefaultProjectId ?? undefined });
    }
  }, []);

  const loadUserSnapshot = useCallback(
    async (nextUser: HeroUser) => {
      const generation = ++loadGenerationRef.current;
      disposeSynced();

      if (nextUser.mode === "demo") {
        const stored = readLocalSnapshot(nextUser.id) ?? createSeedSnapshot();
        if (!readLocalSnapshot(nextUser.id)) {
          persistLocalSnapshot(nextUser.id, stored);
        }
        storeRef.current = createLocalStore(nextUser.id);
        applySnapshot(stored, nextUser.id);
        setRemoteReady(false);
        setStatusMessage("Demo mode is active until Supabase keys are added.");
        return;
      }

      const synced = createSyncedStore(nextUser.id, createRemoteStore(nextUser.id, getAccessToken));
      try {
        const snapshot = await synced.loadSnapshot();
        if (generation !== loadGenerationRef.current) {
          synced.dispose();
          return;
        }
        storeRef.current = synced;
        syncedRef.current = synced;
        syncedUserIdRef.current = nextUser.id;
        applySnapshot(snapshot, nextUser.id);
        // Background pulls only replace the data; selection and the default
        // project survive so a pull never yanks the cursor mid-edit.
        synced.subscribe((next) => {
          setProjects(next.projects);
          setItems(next.items);
          setDefaultProjectIdState((current) => resolveDefaultProjectId(next.projects, current));
        });
        synced.onStatus((status) => setSyncStatus(status));
        synced.onRejected((message) => toast.error(message, { duration: 10_000 }));
        setRemoteReady(true);
        setStatusMessage("Supabase sync is live. Changes save locally first and sync in the background.");
      } catch (error) {
        synced.dispose();
        if (generation !== loadGenerationRef.current) return;
        storeRef.current = createLocalStore(nextUser.id);
        const localFallback = readLocalSnapshot(nextUser.id) ?? { projects: [], items: [] };
        applySnapshot(localFallback, nextUser.id, !readLocalSnapshot(nextUser.id));
        setRemoteReady(false);
        if (error instanceof SchemaMissingError) {
          setStatusMessage(
            "Email sign-in is live, but database tables are not ready yet. Task Man is using a private local fallback until the Supabase schema is applied.",
          );
        } else {
          setStatusMessage(
            "Task Man couldn't reach Supabase and is using a private local fallback for now.",
          );
        }
      }
    },
    [applySnapshot, disposeSynced],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe = () => undefined as void;

    async function bootstrap() {
      if (!supabaseConfigured) {
        const demo = getDemoUser();
        if (!active) return;
        setUser(demo);
        await loadUserSnapshot(demo);
        if (!active) return;
        setAuthChecked(true);
        return;
      }

      const session = await getInitialSession();
      const nextUser = await getSupabaseUserFromSession(session);
      if (!active) return;

      if (nextUser) {
        setUser(nextUser);
        await loadUserSnapshot(nextUser);
      }
      if (!active) return;
      setAuthChecked(true);

      unsubscribe = onAuthChange(async (_event, nextSession) => {
        const changedUser = await getSupabaseUserFromSession(nextSession);
        if (!active) return;

        if (!changedUser) {
          loadGenerationRef.current += 1;
          disposeSynced();
          storeRef.current = null;
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
        if (syncedUserIdRef.current === changedUser.id) return;
        await loadUserSnapshot(changedUser);
      });
    }

    void bootstrap();

    return () => {
      active = false;
      unsubscribe();
      loadGenerationRef.current += 1;
      disposeSynced();
    };
  }, [disposeSynced, loadUserSnapshot]);

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

  // Done + starred + completed today, newest first. These linger in the Today
  // view as "trophies" even though done tasks normally disappear — a vanity
  // shelf of the starred wins you cleared today. Derived from the already-sorted
  // doneItems, re-filtered against the user's local day so a task finished at
  // 11pm doesn't bleed across the midnight boundary in another timezone.
  const starredDoneTodayItems = useMemo(() => {
    const dayKey = getLocalDayKey(new Date());
    return doneItems.filter(
      (item) => item.isStarred && item.completedAt && getLocalDayKey(item.completedAt) === dayKey,
    );
  }, [doneItems]);

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
      const store = storeRef.current;
      if (!store) return { ok: false, message: "Please sign in first." };

      const draft: HeroProject = {
        id: createRecordId(),
        name: name.trim(),
        tone,
        createdAt: new Date().toISOString(),
      };

      try {
        const inserted = await store.insertProject(draft);
        setProjects((current) => [...current, inserted]);
        setActiveProjectId(inserted.id);
        if (!defaultProjectId) {
          setDefaultProjectIdState(inserted.id);
          persistPreferences(user.id, { defaultProjectId: inserted.id });
        }
        return { ok: true, message: `Project “${inserted.name}” added.` };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Couldn't save the project.",
        };
      }
    },
    [defaultProjectId, projects.length, user],
  );


  const saveDraft = useCallback(
    async (draft: CaptureDraft): Promise<MutationResult> => {
      if (!user) return { ok: false, message: "Please sign in first." };
      const store = storeRef.current;
      if (!store) return { ok: false, message: "Please sign in first." };

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
        if (!parsed) return { ok: false, message: "Task Man could not interpret that reminder time." };
        nextDueAt = parsed.toISOString();
      }

      if (!nextTitle) return { ok: false, message: "Give the item a title before saving." };
      if (draft.type === "link" && draft.url && !/^https?:\/\//.test(draft.url)) {
        return { ok: false, message: "Link items should use a full https:// URL." };
      }

      const now = new Date().toISOString();
      const nextProjectId =
        sanitizeProjectId(draft.projectId) ?? resolveDefaultProjectId(projects, defaultProjectId) ?? undefined;
      const candidate: HeroItem = {
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

      try {
        const inserted = await store.insertItem(candidate);
        setItems((current) => [...current, inserted]);
        setSelectedId(inserted.id);
        setUndoState({ kind: "create", item: inserted });
        setComposerOpen(false);
        return { ok: true, message: `Saved for ${formatDueLabel(inserted.dueAt)}.` };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Couldn't save the task.",
        };
      }
    },
    [defaultProjectId, projects, user],
  );

  const updateItem = useCallback(
    async (itemId: string, patch: Partial<HeroItem>): Promise<MutationResult> => {
      const store = storeRef.current;
      if (!store) return { ok: false, message: "Please sign in first." };

      const nextUpdatedAt = patch.updatedAt ?? new Date().toISOString();
      try {
        const updated = await store.updateItem(itemId, { ...patch, updatedAt: nextUpdatedAt });
        setItems((current) => current.map((item) => (item.id === itemId ? updated : item)));
        return { ok: true, message: "Item updated." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Couldn't update the item.",
        };
      }
    },
    [],
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
      const store = storeRef.current;
      if (!store) return { ok: false, message: "Please sign in first." };

      try {
        await store.deleteItem(itemId);
        setItems((current) => current.filter((item) => item.id !== itemId));
        setUndoState({ kind: "delete", item: target });
        const nextUpcoming = upcomingItems.filter((item) => item.id !== itemId);
        setSelectedId(nextUpcoming[0]?.id ?? null);
        return { ok: true, message: "Item deleted." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Couldn't delete the item.",
        };
      }
    },
    [items, upcomingItems],
  );

  const undoLastAction = useCallback(async (): Promise<MutationResult> => {
    if (!undoState) return { ok: false, message: "Nothing to undo." };
    const store = storeRef.current;
    if (!store) return { ok: false, message: "Please sign in first." };

    const sortByCreatedAt = (a: HeroItem, b: HeroItem) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    try {
      if (undoState.kind === "delete") {
        const inserted = await store.insertItem(undoState.item);
        setItems((current) => [...current, inserted].sort(sortByCreatedAt));
        setSelectedId(inserted.id);
        setUndoState(null);
        return { ok: true, message: "Deletion undone." };
      }

      if (undoState.kind === "create") {
        await store.deleteItem(undoState.item.id);
        setItems((current) => current.filter((item) => item.id !== undoState.item.id));
        setUndoState(null);
        return { ok: true, message: "Creation undone." };
      }

      const restored = undoState.item;
      const updated = await store.updateItem(restored.id, {
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
      setItems((current) => current.map((item) => (item.id === restored.id ? updated : item)));
      setSelectedId(restored.id);
      const message = undoState.kind === "done" ? "Completion undone." : "Change undone.";
      setUndoState(null);
      return { ok: true, message };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Couldn't undo.",
      };
    }
  }, [undoState]);

  const breakDownAndResnooze = useCallback(
    async (itemId: string, smallerStep: string, dueInput: string): Promise<MutationResult> => {
      const target = items.find((item) => item.id === itemId);
      const parsed = normalizeParsedDate(dueInput);
      if (!target || !parsed) {
        return { ok: false, message: "Task Man needs both a smaller step and a valid reminder time." };
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
    async (
      projectId: string,
      patch: Partial<Pick<HeroProject, "name" | "tone">>,
    ): Promise<MutationResult> => {
      const target = projects.find((project) => project.id === projectId);
      if (!target) return { ok: false, message: "Project not found." };
      const store = storeRef.current;
      if (!store) return { ok: false, message: "Please sign in first." };

      const nextName = patch.name?.trim() ?? target.name;
      const nextTone = patch.tone ?? target.tone;
      if (!nextName) return { ok: false, message: "Give the project a name first." };

      try {
        const updated = await store.updateProject(projectId, { name: nextName, tone: nextTone });
        setProjects((current) =>
          current.map((project) => (project.id === projectId ? updated : project)),
        );
        return { ok: true, message: "Project updated." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Couldn't update the project.",
        };
      }
    },
    [projects],
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

  // Drop reorder: the dragged task is retimed so it slides directly below the
  // drop target in the due-sorted list. The wake-up time becomes one minute
  // after the target's — unless the task that currently follows the target is
  // less than a minute away, in which case a full minute would overshoot it
  // and the dragged task would land below that task instead of below the
  // target. So when there isn't room for a full minute, the task is placed at
  // the midpoint between the target and whatever follows it, which keeps it
  // strictly between the two. It also adopts the target's chain parent so it
  // lands as a sibling of the target rather than dangling in an unrelated chain,
  // and the target's project, so dropping onto a row in another project's
  // container moves the task into that container at that position.
  const moveItem = useCallback(
    async (itemId: string, targetId: string): Promise<MutationResult> => {
      const source = items.find((item) => item.id === itemId);
      const target = items.find((item) => item.id === targetId);

      if (!source || !target) {
        return { ok: false, message: "Task Man could not find that task to move." };
      }

      if (source.id === target.id) {
        return { ok: false, message: "Choose a different task as the drop target." };
      }

      const sourceDescendants = collectDescendantIds(items, source.id);
      if (sourceDescendants.has(target.id)) {
        return { ok: false, message: "A task cannot be dropped inside its own chain." };
      }

      const targetTime = new Date(target.dueAt).getTime();
      // The wake-up time of whatever currently sits directly below the target:
      // the soonest task strictly later than it (the dragged task excluded).
      const nextTime = items
        .filter((item) => item.id !== itemId && new Date(item.dueAt).getTime() > targetTime)
        .reduce<number | undefined>((soonest, item) => {
          const time = new Date(item.dueAt).getTime();
          return soonest === undefined || time < soonest ? time : soonest;
        }, undefined);

      const oneMinuteAfter = targetTime + 60_000;
      const nextDueAtMs =
        nextTime === undefined || oneMinuteAfter < nextTime
          ? oneMinuteAfter
          : targetTime + Math.floor((nextTime - targetTime) / 2);

      const nextDueAt = new Date(nextDueAtMs).toISOString();
      const targetProjectId =
        sanitizeProjectId(target.projectId) ?? resolveDefaultProjectId(projects, defaultProjectId) ?? undefined;
      const sourceProjectId =
        sanitizeProjectId(source.projectId) ?? resolveDefaultProjectId(projects, defaultProjectId) ?? undefined;
      const patch: Partial<HeroItem> = {
        dueAt: nextDueAt,
        brokenDownFromId: target.brokenDownFromId,
      };
      if (targetProjectId !== sourceProjectId) patch.projectId = targetProjectId;

      const result = await updateItem(itemId, patch);

      if (!result.ok) return result;
      setUndoState({ kind: "update", item: source });
      const projectName = projects.find((project) => project.id === targetProjectId)?.name;
      return {
        ok: true,
        message:
          patch.projectId !== undefined && projectName
            ? `Moved to ${projectName}, after “${target.title}”.`
            : `Moved after “${target.title}”.`,
      };
    },
    [defaultProjectId, items, projects, updateItem],
  );

  // Container drop: dropping a task on a project's empty area (or header)
  // moves it into that project without retiming it. Returns ok with "No
  // changes." when it is already there so the UI can stay quiet.
  const moveItemToProject = useCallback(
    async (itemId: string, projectId: string | undefined): Promise<MutationResult> => {
      const source = items.find((item) => item.id === itemId);
      if (!source) return { ok: false, message: "Task Man could not find that task to move." };

      const nextProjectId = sanitizeProjectId(projectId);
      const currentProjectId =
        sanitizeProjectId(source.projectId) ?? resolveDefaultProjectId(projects, defaultProjectId) ?? undefined;
      if (nextProjectId === currentProjectId) return { ok: true, message: "No changes." };

      const result = await updateItem(itemId, { projectId: nextProjectId });
      if (!result.ok) return result;
      setUndoState({ kind: "update", item: source });
      const projectName = projects.find((project) => project.id === nextProjectId)?.name ?? "Unsorted";
      return { ok: true, message: `Moved to ${projectName}.` };
    },
    [defaultProjectId, items, projects, updateItem],
  );

  const syncNow = useCallback(async () => {
    await syncedRef.current?.syncNow();
  }, []);

  const signIn = useCallback(async (): Promise<MutationResult> => {
    if (!supabaseConfigured) {
      const demo = getDemoUser();
      setUser(demo);
      await loadUserSnapshot(demo);
      setAuthChecked(true);
      return { ok: true, message: "Signed into demo mode." };
    }

    return {
      ok: false,
      message: "Use an email magic link to sign in to the hosted workspace.",
    };
  }, [loadUserSnapshot]);

  const sendMagicLink = useCallback(
    async (email: string): Promise<MutationResult> => {
      if (!supabaseConfigured) return signIn();

      const normalizedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { ok: false, message: "Enter a valid email address." };
      }

      try {
        const { error } = await authSendMagicLink(normalizedEmail, window.location.origin);
        if (error) return { ok: false, message: error.message };
        return { ok: true, message: `Check ${normalizedEmail} for your sign-in link.` };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Could not send the sign-in link. Please try again.",
        };
      }
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    if (!supabaseConfigured || user?.mode === "demo") {
      disposeSynced();
      storeRef.current = null;
      setUser(null);
      setProjects([]);
      setItems([]);
      setSelectedId(null);
      setRemoteReady(false);
      return;
    }
    await authSignOut();
  }, [disposeSynced, user?.mode]);

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
    starredDoneTodayItems,
    statusMessage,
    streak,
    syncStatus,
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
    moveItemToProject,
    parseCaptureInput,
    previewCaptureInput,
    removeItem,
    renameItem,
    rescheduleItem,
    saveDraft,
    setDefaultProject,
    signIn,
    sendMagicLink,
    signOut,
    syncNow,
    toggleStar,
    undoLastAction,
    updateProject,
  };
}
