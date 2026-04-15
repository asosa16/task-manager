/*
Design note for this file:
- Tactile paper dashboard logic backing a fast, opinionated planner.
- Preserve the legacy Hero spirit: quick capture, unified queue, calm urgency, and lightweight momentum.
- Favor terse state transitions and compact domain objects over abstract enterprise modeling.
*/
import { useCallback, useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
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
  brokenDownFromId?: string;
  originalTitle?: string;
}

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
  projectId?: string;
  type: HeroItemType;
  url?: string;
  isRecurringDaily?: boolean;
}

interface HeroSnapshot {
  projects: HeroProject[];
  items: HeroItem[];
}

interface UndoState {
  kind: "delete" | "done";
  item: HeroItem;
}

export const legacyShortcutHints = [
  { key: "N", description: "Quick add" },
  { key: "J / K", description: "Move focus" },
  { key: "D", description: "Mark selected done" },
  { key: "X", description: "Delete selected" },
  { key: "/", description: "Jump to filters" },
  { key: "U", description: "Undo last action" },
];

export const toneClassMap: Record<ProjectTone, string> = {
  moss: "bg-[#a6b28a] text-[#233127] border-[#87966c]",
  slate: "bg-[#7f94a3] text-white border-[#647784]",
  amber: "bg-[#d6a05b] text-[#352410] border-[#b57c38]",
  clay: "bg-[#ba7a5e] text-[#fff8f3] border-[#9c6148]",
  ink: "bg-[#3b4d5c] text-[#f7f1e8] border-[#2d3b47]",
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

const orderedTones: ProjectTone[] = ["moss", "slate", "amber", "clay", "ink"];

function storageKey(userId: string) {
  return `hero-web::snapshot::${userId}`;
}

function serialize(snapshot: HeroSnapshot) {
  window.localStorage.setItem(storageKey("demo-user"), JSON.stringify(snapshot));
}

function readSerialized(userId: string): HeroSnapshot | null {
  const raw = window.localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HeroSnapshot;
  } catch {
    return null;
  }
}

function persistSnapshot(userId: string, snapshot: HeroSnapshot) {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(snapshot));
}

function createSeedProjects(): HeroProject[] {
  const now = new Date().toISOString();
  return [
    { id: "project-personal", name: "Personal", tone: "moss", createdAt: now },
    { id: "project-work", name: "Work", tone: "slate", createdAt: now },
    { id: "project-reading", name: "Reading", tone: "amber", createdAt: now },
  ];
}

function offset(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createSeedItems(projects: HeroProject[]): HeroItem[] {
  return [
    {
      id: nanoid(),
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
      id: nanoid(),
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
      id: nanoid(),
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
      id: nanoid(),
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

function normalizeParsedDate(input: string) {
  if (!input.trim()) return null;
  const parsed = chrono.parseDate(input, new Date(), { forwardDate: true });
  return parsed ?? null;
}

function humanTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDueLabel(input: string) {
  const date = new Date(input);
  const now = new Date();
  const diffDays = Math.round((date.getTime() - now.getTime()) / 86400000);

  if (diffDays === 0) {
    return `Today · ${humanTime(date)}`;
  }
  if (diffDays === 1) {
    return `Tomorrow · ${humanTime(date)}`;
  }
  if (diffDays === -1) {
    return `Yesterday · ${humanTime(date)}`;
  }
  if (diffDays < 7 && diffDays > -7) {
    return `${new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date)} · ${humanTime(date)}`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function getDueMood(input: string) {
  const time = new Date(input).getTime();
  const delta = time - Date.now();
  if (delta < 0) return "overdue";
  if (delta < 1000 * 60 * 60 * 18) return "soon";
  return "later";
}

export function formatPreviewFromInput(input: string) {
  const parsed = normalizeParsedDate(input);
  if (!parsed) return "Type a natural-language reminder like tomorrow 9am or in 3 days.";
  return `Hero interprets that as ${formatDueLabel(parsed.toISOString())}.`;
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

export function useHeroApp() {
  const [user, setUser] = useState<HeroUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [projects, setProjects] = useState<HeroProject[]>([]);
  const [items, setItems] = useState<HeroItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    supabase ? "Supabase auth is ready. Add project keys and SQL to complete live sync." : "Demo mode is active until Supabase keys are added.",
  );

  const applySnapshot = useCallback((snapshot: HeroSnapshot, userId: string) => {
    setProjects(snapshot.projects);
    setItems(snapshot.items);
    if (!snapshot.projects.length) {
      const seeded = createSeedSnapshot();
      setProjects(seeded.projects);
      setItems(seeded.items);
      persistSnapshot(userId, seeded);
      setSelectedId(seeded.items.find((item) => item.status === "upcoming")?.id ?? null);
      return;
    }

    setSelectedId(
      snapshot.items.find((item) => item.status === "upcoming")?.id ??
        snapshot.items[0]?.id ??
        null,
    );
  }, []);

  const loadUserSnapshot = useCallback(
    (nextUser: HeroUser) => {
      const stored = readSerialized(nextUser.id) ?? createSeedSnapshot();
      if (!readSerialized(nextUser.id)) {
        persistSnapshot(nextUser.id, stored);
      }
      applySnapshot(stored, nextUser.id);
    },
    [applySnapshot],
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      if (!supabase) {
        const demo = getDemoUser();
        if (!active) return;
        setUser(demo);
        loadUserSnapshot(demo);
        setAuthChecked(true);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const nextUser = await getSupabaseUserFromSession(data.session);
      if (!active) return;

      if (nextUser) {
        setUser(nextUser);
        loadUserSnapshot(nextUser);
        setStatusMessage("Supabase auth is live. Data is running in local-first mode until your tables are connected.");
      }
      setAuthChecked(true);

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (_event, session) => {
        const changedUser = await getSupabaseUserFromSession(session);
        if (!changedUser) {
          setUser(null);
          setProjects([]);
          setItems([]);
          return;
        }

        setUser(changedUser);
        loadUserSnapshot(changedUser);
        setStatusMessage("Supabase auth is live. Data is running in local-first mode until your tables are connected.");
      });

      return () => subscription.unsubscribe();
    }

    const cleanupPromise = bootstrap();
    return () => {
      active = false;
      void cleanupPromise;
    };
  }, [loadUserSnapshot]);

  const persist = useCallback(
    (nextProjects: HeroProject[], nextItems: HeroItem[]) => {
      if (!user) return;
      persistSnapshot(user.id, { projects: nextProjects, items: nextItems });
      setProjects(nextProjects);
      setItems(nextItems);
    },
    [user],
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

  const selectedItem = upcomingItems[selectedIndex] ?? null;
  const overdueCount = upcomingItems.filter((item) => new Date(item.dueAt).getTime() < Date.now()).length;
  const doneTodayCount = doneItems.filter((item) => {
    const value = item.completedAt ? new Date(item.completedAt) : null;
    if (!value) return false;
    return value.toDateString() === new Date().toDateString();
  }).length;

  const dueNowItem = useMemo(
    () => upcomingItems.find((item) => new Date(item.dueAt).getTime() <= Date.now()) ?? null,
    [upcomingItems],
  );

  const addProject = useCallback(
    (name: string) => {
      if (!user || !name.trim()) return;
      const nextProject: HeroProject = {
        id: nanoid(),
        name: name.trim(),
        tone: orderedTones[projects.length % orderedTones.length],
        createdAt: new Date().toISOString(),
      };
      persist([...projects, nextProject], items);
      setActiveProjectId(nextProject.id);
    },
    [items, persist, projects, user],
  );

  const saveDraft = useCallback(
    (draft: CaptureDraft) => {
      if (!user) return { ok: false, message: "Please sign in first." };
      const parsed = normalizeParsedDate(draft.dueInput);
      if (!parsed) return { ok: false, message: "Hero could not interpret that reminder time." };
      if (!draft.title.trim()) return { ok: false, message: "Give the item a title before saving." };
      if (draft.type === "link" && draft.url && !/^https?:\/\//.test(draft.url)) {
        return { ok: false, message: "Link items should use a full https:// URL." };
      }

      const now = new Date().toISOString();
      const next: HeroItem = {
        id: nanoid(),
        title: draft.title.trim(),
        type: draft.type,
        status: "upcoming",
        dueAt: parsed.toISOString(),
        createdAt: now,
        updatedAt: now,
        url: draft.type === "link" ? draft.url?.trim() : undefined,
        projectId: draft.projectId || undefined,
        isRecurringDaily: draft.isRecurringDaily,
        originalTitle: draft.type === "task" ? draft.title.trim() : undefined,
      };

      const nextItems = [...items, next];
      persist(projects, nextItems);
      setSelectedId(next.id);
      setComposerOpen(false);
      return { ok: true, message: `Saved for ${formatDueLabel(next.dueAt)}.` };
    },
    [items, persist, projects, user],
  );

  const updateItem = useCallback(
    (itemId: string, patch: Partial<HeroItem>) => {
      const nextItems = items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : item,
      );
      persist(projects, nextItems);
    },
    [items, persist, projects],
  );

  const renameItem = useCallback(
    (itemId: string, title: string) => {
      if (!title.trim()) return;
      updateItem(itemId, { title: title.trim() });
    },
    [updateItem],
  );

  const rescheduleItem = useCallback(
    (itemId: string, dueInput: string) => {
      const parsed = normalizeParsedDate(dueInput);
      if (!parsed) return { ok: false, message: "Could not interpret the new reminder time." };
      updateItem(itemId, { dueAt: parsed.toISOString() });
      return { ok: true, message: `Rescheduled to ${formatDueLabel(parsed.toISOString())}.` };
    },
    [updateItem],
  );

  const markDone = useCallback(
    (itemId: string) => {
      const target = items.find((item) => item.id === itemId);
      if (!target) return;
      const completedAt = new Date().toISOString();
      const nextItem = { ...target, status: "done" as const, completedAt, updatedAt: completedAt };
      setUndoState({ kind: "done", item: target });
      persist(
        projects,
        items.map((item) => (item.id === itemId ? nextItem : item)),
      );
      const nextUpcoming = upcomingItems.filter((item) => item.id !== itemId);
      setSelectedId(nextUpcoming[0]?.id ?? null);
    },
    [items, persist, projects, upcomingItems],
  );

  const removeItem = useCallback(
    (itemId: string) => {
      const target = items.find((item) => item.id === itemId);
      if (!target) return;
      setUndoState({ kind: "delete", item: target });
      const nextItems = items.filter((item) => item.id !== itemId);
      persist(projects, nextItems);
      const nextUpcoming = upcomingItems.filter((item) => item.id !== itemId);
      setSelectedId(nextUpcoming[0]?.id ?? null);
    },
    [items, persist, projects, upcomingItems],
  );

  const undoLastAction = useCallback(() => {
    if (!undoState) return;
    const nextItems = [...items, undoState.item].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    persist(projects, nextItems);
    setSelectedId(undoState.item.id);
    setUndoState(null);
  }, [items, persist, projects, undoState]);

  const breakDownAndResnooze = useCallback(
    (itemId: string, smallerStep: string, dueInput: string) => {
      const target = items.find((item) => item.id === itemId);
      const parsed = normalizeParsedDate(dueInput);
      if (!target || !parsed) {
        return { ok: false, message: "Hero needs both a smaller step and a valid reminder time." };
      }
      const nextTitle = smallerStep.trim() || target.title;
      updateItem(itemId, {
        title: nextTitle,
        dueAt: parsed.toISOString(),
        brokenDownFromId: target.brokenDownFromId || target.id,
        originalTitle: target.originalTitle || target.title,
      });
      return { ok: true, message: `Smaller next step scheduled for ${formatDueLabel(parsed.toISOString())}.` };
    },
    [items, updateItem],
  );

  const signIn = useCallback(async () => {
    if (!supabase) {
      const demo = getDemoUser();
      setUser(demo);
      loadUserSnapshot(demo);
      setAuthChecked(true);
      setStatusMessage("Demo mode is active. Add Supabase keys to enable Google sign-in.");
      return { ok: true, message: "Signed into demo mode." };
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Redirecting to Google…" };
  }, [loadUserSnapshot]);

  const signOut = useCallback(async () => {
    if (!supabase || user?.mode === "demo") {
      setUser(null);
      setProjects([]);
      setItems([]);
      return;
    }
    await supabase.auth.signOut();
  }, [user?.mode]);

  const streak = useMemo(() => {
    const dates = new Set(
      doneItems
        .map((item) => item.completedAt?.slice(0, 10))
        .filter(Boolean) as string[],
    );
    let count = 0;
    const cursor = new Date();
    while (dates.has(cursor.toISOString().slice(0, 10))) {
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
    doneItems,
    doneTodayCount,
    dueNowItem,
    items,
    legacyShortcutHints,
    overdueCount,
    projectOptions,
    projects,
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
    formatPreviewFromInput,
    markDone,
    removeItem,
    renameItem,
    rescheduleItem,
    saveDraft,
    signIn,
    signOut,
    undoLastAction,
  };
}
