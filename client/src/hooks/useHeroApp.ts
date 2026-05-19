/*
Design note for this file:
- Keep Hero fast and opinionated, but make the state layer honest about storage: demo, local fallback, or live Supabase.
- Preserve compact domain objects and shortcut-driven actions rather than introducing heavy app architecture.
- The web rebuild should support per-user hosted sync with simple email/password auth first, while remaining usable before external setup is finished.
*/
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as chrono from "chrono-node";
import { type Session } from "@supabase/supabase-js";

import {
  getAccessToken,
  getInitialSession,
  onAuthChange,
  signInWithPassword as authSignInWithPassword,
  signOut as authSignOut,
  signUpWithPassword as authSignUpWithPassword,
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
      "Hero User",
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
  const [statusMessage, setStatusMessage] = useState<string>(
    supabaseConfigured
      ? "Hosted sync is ready. Sign in with email and password to load your Hero workspace."
      : "Demo mode is active until Supabase keys are added.",
  );

  // The active HeroStore: local for demo or fallback, remote for live. Swapped
  // inside loadUserSnapshot based on mode, read by every mutation. Kept in a
  // ref rather than state because the store change is always paired with an
  // applySnapshot/setProjects/setItems that already triggers a re-render.
  const storeRef = useRef<HeroStore | null>(null);

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

      const remoteStore = createRemoteStore(nextUser.id, getAccessToken);
      try {
        const remoteSnapshot = await remoteStore.loadSnapshot();
        storeRef.current = remoteStore;
        applySnapshot(remoteSnapshot, nextUser.id);
        setRemoteReady(true);
        setStatusMessage("Google sign-in and Supabase sync are live.");
      } catch (error) {
        storeRef.current = createLocalStore(nextUser.id);
        const localFallback = readLocalSnapshot(nextUser.id) ?? { projects: [], items: [] };
        applySnapshot(localFallback, nextUser.id, !readLocalSnapshot(nextUser.id));
        setRemoteReady(false);
        if (error instanceof SchemaMissingError) {
          setStatusMessage(
            "Google sign-in is live, but database tables are not ready yet. Hero is using a private local fallback until the Supabase schema is applied.",
          );
        } else {
          setStatusMessage(
            "Hero couldn't reach Supabase and is using a private local fallback for now.",
          );
        }
      }
    },
    [applySnapshot],
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
        await loadUserSnapshot(changedUser);
      });
    }

    void bootstrap();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadUserSnapshot]);

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
        if (!parsed) return { ok: false, message: "Hero could not interpret that reminder time." };
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

  // Drop reorder: the dragged task's wake-up time becomes one minute after the
  // drop target's, which slides it directly below that task in the due-sorted
  // list. It also adopts the target's chain parent so it lands as a sibling of
  // the target rather than dangling inside an unrelated chain.
  const moveItem = useCallback(
    async (itemId: string, targetId: string): Promise<MutationResult> => {
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

      const nextDueAt = new Date(new Date(target.dueAt).getTime() + 60_000).toISOString();
      const result = await updateItem(itemId, {
        dueAt: nextDueAt,
        brokenDownFromId: target.brokenDownFromId,
      });

      if (!result.ok) return result;
      setUndoState({ kind: "update", item: source });
      return { ok: true, message: `Moved after “${target.title}”.` };
    },
    [items, updateItem],
  );

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
      message: "Use email and password to sign in to the hosted workspace.",
    };
  }, [loadUserSnapshot]);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<MutationResult> => {
      if (!supabaseConfigured) {
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

      try {
        const { error } = await authSignInWithPassword(normalizedEmail, password);
        if (error) return { ok: false, message: error.message };
        return { ok: true, message: "Signed in." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Sign-in failed.",
        };
      }
    },
    [loadUserSnapshot],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string): Promise<MutationResult> => {
      if (!supabaseConfigured) {
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

      try {
        const { data, error } = await authSignUpWithPassword(
          normalizedEmail,
          password,
          window.location.origin,
        );
        if (error) return { ok: false, message: error.message };
        if (data.session) return { ok: true, message: "Account created and signed in." };
        return { ok: true, message: "Account created. Check your email if confirmation is enabled." };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Sign-up failed.",
        };
      }
    },
    [loadUserSnapshot],
  );

  const signOut = useCallback(async () => {
    if (!supabaseConfigured || user?.mode === "demo") {
      storeRef.current = null;
      setUser(null);
      setProjects([]);
      setItems([]);
      setSelectedId(null);
      setRemoteReady(false);
      return;
    }
    await authSignOut();
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
