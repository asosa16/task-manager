/*
Design note for this file:
- Keep Hero fast and opinionated, but make the state layer honest about storage: demo, local fallback, or live Supabase.
- Preserve compact domain objects and shortcut-driven actions rather than introducing heavy app architecture.
- The web rebuild should support per-user hosted sync with simple email/password auth first, while remaining usable before external setup is finished.
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
  broken_down_from_id: string | null;
  original_title: string | null;
}

export const legacyShortcutHints = [
  { key: "N", description: "Quick add" },
  { key: "J / K", description: "Move focus" },
  { key: "D", description: "Mark selected done" },
  { key: "Delete", description: "Delete selected" },
  { key: "E", description: "Edit selected item" },
  { key: "Z / U", description: "Undo last action" },
];

export const toneClassMap: Record<ProjectTone, string> = {
  moss: "bg-white text-black border-black/20",
  slate: "bg-[#efefef] text-black border-black/15",
  amber: "bg-[#dcdcdc] text-black border-black/15",
  clay: "bg-[#cfcfcf] text-black border-black/15",
  ink: "bg-black text-white border-black",
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
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value?: string | null): value is string {
  return Boolean(value && uuidPattern.test(value));
}

function createRecordId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return nanoid();
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
  if (!parsed) return "";

  return formatDueLabel(parsed.toISOString())
    .replace("Today · ", "today at ")
    .replace("Tomorrow · ", "tomorrow at ")
    .replace("Yesterday · ", "yesterday at ")
    .replace(" · ", " at ");
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
    brokenDownFromId: row.broken_down_from_id ?? undefined,
    originalTitle: row.original_title ?? undefined,
  };
}

function toProjectInsert(project: HeroProject, userId: string): ProjectRow {
  const safeProject = ensureRemoteSafeProject(project);

  return {
    id: safeProject.id,
    user_id: userId,
    name: safeProject.name,
    tone: safeProject.tone,
    created_at: safeProject.createdAt,
  };
}

function toItemInsert(item: HeroItem, userId: string): ItemRow {
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

export function useHeroApp() {
  const [user, setUser] = useState<HeroUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [projects, setProjects] = useState<HeroProject[]>([]);
  const [items, setItems] = useState<HeroItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    setProjects(snapshot.projects);
    setItems(snapshot.items);
    setSelectedId(nextSelectedIdFromItems(snapshot.items));
    if (persistLocally) {
      persistSnapshot(userId, snapshot);
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

      const subscription = supabase.auth.onAuthStateChange(async (_event, session) => {
        const changedUser = await getSupabaseUserFromSession(session);
        if (!active) return;

        if (!changedUser) {
          setUser(null);
          setProjects([]);
          setItems([]);
          setSelectedId(null);
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

  const commitLocalSnapshot = useCallback(
    (nextProjects: HeroProject[], nextItems: HeroItem[]) => {
      setProjects(nextProjects);
      setItems(nextItems);
      setSelectedId(nextSelectedIdFromItems(nextItems));
      if (user) {
        persistSnapshot(user.id, { projects: nextProjects, items: nextItems });
      }
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

  const selectedItem = upcomingItems[selectedIndex] ?? items.find((item) => item.id === selectedId) ?? null;
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
    async (name: string): Promise<MutationResult> => {
      if (!user || !name.trim()) return { ok: false, message: "Give the project a name first." };

      const nextProject: HeroProject = {
        id: createRecordId(),
        name: name.trim(),
        tone: orderedTones[projects.length % orderedTones.length],
        createdAt: new Date().toISOString(),
      };


      if (user.mode === "demo" || !remoteReady || !supabase) {
        const nextProjects = [...projects, nextProject];
        commitLocalSnapshot(nextProjects, items);
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
      return { ok: true, message: `Project “${inserted.name}” added.` };
    },
    [commitLocalSnapshot, items, projects, remoteReady, user],
  );

  const saveDraft = useCallback(
    async (draft: CaptureDraft): Promise<MutationResult> => {
      if (!user) return { ok: false, message: "Please sign in first." };
      const parsed = normalizeParsedDate(draft.dueInput);
      if (!parsed) return { ok: false, message: "Hero could not interpret that reminder time." };
      if (!draft.title.trim()) return { ok: false, message: "Give the item a title before saving." };
      if (draft.type === "link" && draft.url && !/^https?:\/\//.test(draft.url)) {
        return { ok: false, message: "Link items should use a full https:// URL." };
      }

      const now = new Date().toISOString();
      const next: HeroItem = {
        id: createRecordId(),
        title: draft.title.trim(),
        type: draft.type,
        status: "upcoming",
        dueAt: parsed.toISOString(),
        createdAt: now,
        updatedAt: now,
        url: draft.type === "link" ? draft.url?.trim() : undefined,
        projectId: sanitizeProjectId(draft.projectId),
        isRecurringDaily: draft.isRecurringDaily,
        originalTitle: draft.type === "task" ? draft.title.trim() : undefined,
      };


      if (user.mode === "demo" || !remoteReady || !supabase) {
        const nextItems = [...items, next];
        commitLocalSnapshot(projects, nextItems);
        setSelectedId(next.id);
        setComposerOpen(false);
        return { ok: true, message: `Saved for ${formatDueLabel(next.dueAt)}.` };
      }

      const result = await supabase.from("items").insert(toItemInsert(next, user.id)).select().single();
      if (result.error) {
        return { ok: false, message: result.error.message };
      }

      const inserted = mapItemRow(result.data as ItemRow);
      setItems((current) => [...current, inserted]);
      setSelectedId(inserted.id);
      setComposerOpen(false);
      return { ok: true, message: `Saved for ${formatDueLabel(inserted.dueAt)}.` };
    },
    [commitLocalSnapshot, items, projects, remoteReady, user],
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
    [commitLocalSnapshot, items, projects, remoteReady, user],
  );

  const renameItem = useCallback(
    async (itemId: string, title: string): Promise<MutationResult> => {
      if (!title.trim()) return { ok: false, message: "Give the item a title first." };
      return updateItem(itemId, { title: title.trim() });
    },
    [updateItem],
  );

  const rescheduleItem = useCallback(
    async (itemId: string, dueInput: string): Promise<MutationResult> => {
      const parsed = normalizeParsedDate(dueInput);
      if (!parsed) return { ok: false, message: "Could not interpret the new reminder time." };
      const result = await updateItem(itemId, { dueAt: parsed.toISOString() });
      if (!result.ok) return result;
      return { ok: true, message: `Rescheduled to ${formatDueLabel(parsed.toISOString())}.` };
    },
    [updateItem],
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
      brokenDownFromId: restored.brokenDownFromId,
      originalTitle: restored.originalTitle,
    });
    if (!result.ok) return result;
    setSelectedId(restored.id);
    setUndoState(null);
    return { ok: true, message: "Completion undone." };
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
      return { ok: true, message: `Smaller next step scheduled for ${formatDueLabel(parsed.toISOString())}.` };
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
    formatPreviewFromInput,
    markDone,
    removeItem,
    renameItem,
    rescheduleItem,
    saveDraft,
    signIn,
    signInWithPassword,
    signOut,
    signUpWithPassword,
    undoLastAction,
  };
}
