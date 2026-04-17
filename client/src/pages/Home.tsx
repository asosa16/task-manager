/*
Design note for this file:
- Re-center Hero on the original extension ritual: one line in, one calm list out.
- Keep the surface sparse and monochrome; secondary actions should stay hidden until asked for.
- Today is the default home, while All and Analytics stay lightweight and adjacent rather than competing for attention.
*/
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  formatDueLabel,
  parseCaptureInput,
  previewCaptureInput,
  toneColorMap,
  toneLabelMap,
  useHeroApp,
  type HeroItem,
  type ProjectTone,
} from "@/hooks/useHeroApp";

const heroLogo =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-128_efe10397.png";

const primaryRouteOrder = ["/", "/all", "/done"] as const;
const projectToneOptions: ProjectTone[] = ["moss", "slate", "amber", "clay", "ink"];

function getPrimaryRouteTarget(currentPath: string, direction: 1 | -1) {
  const current = primaryRouteOrder.includes(currentPath as (typeof primaryRouteOrder)[number])
    ? (currentPath as (typeof primaryRouteOrder)[number])
    : "/";
  const index = primaryRouteOrder.indexOf(current);
  return primaryRouteOrder[(index + direction + primaryRouteOrder.length) % primaryRouteOrder.length];
}

type ListMode = "today" | "all";
type MoveMode = "after" | "chain";

type DisplayRow = {
  item: HeroItem;
  depth: number;
  parentId?: string;
};

function isEditingField(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(element?.isContentEditable);
}

function isDueTodayOrOverdue(input: string) {
  const date = new Date(input);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return date.getTime() <= endOfToday.getTime();
}

function buildDisplayRows(items: HeroItem[]) {
  const sorted = [...items].sort((a, b) => {
    const dueDelta = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (dueDelta !== 0) return dueDelta;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const availableIds = new Set(sorted.map((item) => item.id));
  const children = new Map<string | null, HeroItem[]>();

  sorted.forEach((item) => {
    const parentId = item.brokenDownFromId && availableIds.has(item.brokenDownFromId) ? item.brokenDownFromId : null;
    const bucket = children.get(parentId) ?? [];
    bucket.push(item);
    children.set(parentId, bucket);
  });

  const rows: DisplayRow[] = [];
  const visited = new Set<string>();

  function visit(item: HeroItem, depth: number) {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    rows.push({
      item,
      depth,
      parentId: item.brokenDownFromId && availableIds.has(item.brokenDownFromId) ? item.brokenDownFromId : undefined,
    });
    (children.get(item.id) ?? []).forEach((child) => visit(child, depth + 1));
  }

  (children.get(null) ?? []).forEach((item) => visit(item, 0));
  sorted.forEach((item) => visit(item, 0));

  return rows;
}

function dueLabelForList(input: string) {
  return formatDueLabel(input).replace(" · ", " at ");
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

function ProjectDot({ tone }: { tone: ProjectTone }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full border border-black/15" style={{ backgroundColor: toneColorMap[tone] }} />;
}

function HelpPanel({
  onClose,
  onSignOut,
}: {
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="absolute right-0 top-12 z-30 w-[280px] border border-black bg-white p-3 text-xs shadow-[8px_8px_0_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between border-b border-black pb-2">
        <div className="font-semibold">Help</div>
        <button type="button" onClick={onClose} className="text-black/65 hover:text-black">
          close
        </button>
      </div>
      <div className="mt-3 space-y-2 text-black/72">
        <div className="text-[10px] uppercase tracking-[0.16em] text-black/45">Capture</div>
        <div className="flex items-center justify-between gap-3"><span>focus new task input</span><span className="font-semibold">T <span className="text-black/40">/ ⇧N</span></span></div>
        <div className="flex items-center justify-between gap-3"><span>save the new task</span><span className="font-semibold">Enter</span></div>

        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-black/45">List navigation</div>
        <div className="flex items-center justify-between gap-3"><span>edit &amp; move through tasks</span><span className="font-semibold">↑ / ↓</span></div>
        <div className="flex items-center justify-between gap-3"><span>save inline edit</span><span className="font-semibold">Enter</span></div>
        <div className="flex items-center justify-between gap-3"><span>exit edit, keep selection</span><span className="font-semibold">Esc</span></div>
        <div className="flex items-center justify-between gap-3"><span>switch Today / All / Done</span><span className="font-semibold">Tab</span></div>

        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-black/45">Act on selected task</div>
        <div className="flex items-center justify-between gap-3"><span>mark done</span><span className="font-semibold">⇧⌘D</span></div>
        <div className="flex items-center justify-between gap-3"><span>delete</span><span className="font-semibold">⇧⌘⌫</span></div>
        <div className="flex items-center justify-between gap-3"><span>undo last action (after Esc)</span><span className="font-semibold">Z <span className="text-black/40">/ U</span></span></div>

        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-black/45">Reorder (Today view, after Esc)</div>
        <div className="flex items-center justify-between gap-3"><span>pick up / drop the task</span><span className="font-semibold">Space</span></div>
        <div className="flex items-center justify-between gap-3"><span>drop under another task</span><span className="font-semibold">Enter</span></div>
        <div className="flex items-center justify-between gap-3"><span>drop after another task</span><span className="font-semibold">⇧Enter</span></div>

        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-black/45">Panels</div>
        <div className="flex items-center justify-between gap-3"><span>toggle this help</span><span className="font-semibold">?</span></div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="mt-4 inline-flex min-h-9 items-center border border-black px-3 text-[11px] font-medium uppercase tracking-[0.14em]"
      >
        Sign out
      </button>
    </div>
  );
}

function AuthShell({
  onSignIn,
  onSignUp,
}: {
  onSignIn: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  onSignUp: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result =
      mode === "signin" ? await onSignIn(email, password) : await onSignUp(email, password);

    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
  }

  return (
    <main className="min-h-screen bg-[#f6f6f3] px-4 py-8 text-black">
      <div className="mx-auto max-w-md border border-black bg-white p-5 shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-3 border-b border-black pb-3 text-sm font-semibold">
          <img src={heroLogo} alt="Hero logo" className="h-7 w-7 rounded-[10px]" />
          <span className="text-[15px] uppercase tracking-[0.18em]">Hero</span>
        </div>
        <div className="mt-5 space-y-2">
          <h1 className="text-[24px] font-semibold leading-none">Minimal again.</h1>
          <p className="text-sm leading-6 text-black/68">
            Sign in to keep the same task list usable in the browser and on your phone.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="min-h-11 w-full border border-black bg-white px-3 text-sm outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="min-h-11 w-full border border-black bg-white px-3 text-sm outline-none"
          />
          <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center border border-black bg-black px-4 text-sm text-white">
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <div className="mt-3 flex items-center justify-between text-xs text-black/68">
          <span>{mode === "signin" ? "Need an account?" : "Already have an account?"}</span>
          <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="font-semibold text-black">
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  const hero = useHeroApp();
  const [location, navigate] = useLocation();
  const listMode: ListMode = location === "/all" ? "all" : "today";

  const [captureInput, setCaptureInput] = useState("");
  const [captureProjectId, setCaptureProjectId] = useState("");
  const [captureFocused, setCaptureFocused] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [rescheduleItemId, setRescheduleItemId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("tomorrow 9am");
  const [grabbedItemId, setGrabbedItemId] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [selectionDismissed, setSelectionDismissed] = useState(false);
  const [completingItemId, setCompletingItemId] = useState<string | null>(null);
  const [projectDrafts, setProjectDrafts] = useState<Record<string, { name: string; tone: ProjectTone }>>({});
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTone, setNewProjectTone] = useState<ProjectTone>("moss");
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const captureProjectRef = useRef<HTMLSelectElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const hasAutoFocusedCaptureRef = useRef(false);

  const filteredItems = useMemo(
    () => (listMode === "today" ? hero.upcomingItems.filter((item) => isDueTodayOrOverdue(item.dueAt)) : hero.upcomingItems),
    [hero.upcomingItems, listMode],
  );

  const displayRows = useMemo(() => buildDisplayRows(filteredItems), [filteredItems]);
  const projectById = useMemo(() => new Map(hero.projects.map((project) => [project.id, project])), [hero.projects]);
  const fallbackProjectId = hero.defaultProjectId ?? hero.projects[0]?.id ?? "";
  const selectedIndex = useMemo(() => displayRows.findIndex((row) => row.item.id === hero.selectedId), [displayRows, hero.selectedId]);
  const selectedRow = selectedIndex >= 0 ? displayRows[selectedIndex] : displayRows[0] ?? null;
  const capturePreview = useMemo(() => previewCaptureInput(captureInput), [captureInput]);
  const parsedCapture = useMemo(() => parseCaptureInput(captureInput), [captureInput]);
  const editParsed = useMemo(() => (editItemId ? parseCaptureInput(editValue) : null), [editItemId, editValue]);
  const editPreview = useMemo(() => (editItemId ? previewCaptureInput(editValue) : ""), [editItemId, editValue]);
  const isTyping = editItemId !== null || rescheduleItemId !== null || captureFocused;

  function showActionToast(message: string) {
    toast.success(`${message} Press Z to undo.`);
  }

  function resolveProjectId(projectId?: string | null) {
    return projectId ?? fallbackProjectId;
  }

  function beginItemEdit(item: HeroItem, options?: { openMenu?: boolean }) {
    setSelectionDismissed(false);
    if (options?.openMenu) setMenuItemId(item.id);
    setRescheduleItemId(null);
    setEditItemId(item.id);
    setEditValue(item.title);
    setEditProjectId(resolveProjectId(item.projectId));
    hero.setSelectedId(item.id);
  }

  function isComposerFocusTarget(target: EventTarget | null) {
    return target === captureInputRef.current || target === captureProjectRef.current;
  }

  function releaseComposerFocus() {
    if (isComposerFocusTarget(document.activeElement)) {
      blurActiveElement();
    }
  }

  function focusCaptureComposer() {
    setSelectionDismissed(false);
    setShowHelp(false);
    setMenuItemId(null);
    setGrabbedItemId(null);
    setDraggedItemId(null);
    window.setTimeout(() => {
      captureInputRef.current?.focus();
      captureInputRef.current?.select();
    }, 0);
  }

  function selectItem(itemId: string, options?: { fromListNavigation?: boolean }) {
    setSelectionDismissed(false);
    hero.setSelectedId(itemId);
    if (options?.fromListNavigation) {
      releaseComposerFocus();
    }
  }

  function cyclePrimaryRoute(direction: 1 | -1) {
    navigate(getPrimaryRouteTarget(location, direction));
  }

  function moveSelection(direction: 1 | -1, options?: { enterEdit?: boolean }) {
    if (!displayRows.length) return;
    const baseIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const next = displayRows[Math.min(Math.max(baseIndex + direction, 0), displayRows.length - 1)] ?? selectedRow;
    if (!next) return;
    selectItem(next.item.id, { fromListNavigation: true });
    if (options?.enterEdit) {
      beginItemEdit(next.item);
    }
  }

  async function commitInlineEditIfNeeded() {
    if (!editItemId) return;
    const itemId = editItemId;
    const target = hero.items.find((item) => item.id === itemId);
    const trimmed = editValue.trim();
    if (!target || !trimmed) return;
    const parsed = parseCaptureInput(trimmed);
    const titleChanged = (parsed ? parsed.title : trimmed) !== target.title;
    const dueChanged = parsed && parsed.dueAt !== target.dueAt;
    const projectChanged = (editProjectId || fallbackProjectId) !== resolveProjectId(target.projectId);
    if (!titleChanged && !dueChanged && !projectChanged) return;
    const result = await hero.editCapture(itemId, trimmed, editProjectId || fallbackProjectId || undefined);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    showActionToast(result.message);
  }

  function exitInlineEdit() {
    setEditItemId(null);
    setRescheduleItemId(null);
    blurActiveElement();
  }

  function dismissFocusState() {
    setShowHelp(false);
    setMenuItemId(null);
    setEditItemId(null);
    setRescheduleItemId(null);
    setGrabbedItemId(null);
    setDraggedItemId(null);
    setSelectionDismissed(true);
    hero.setSelectedId(null);
    blurActiveElement();
  }

  useEffect(() => {
    if (!displayRows.length) {
      if (hero.selectedId) hero.setSelectedId(null);
      return;
    }

    if (selectionDismissed && !hero.selectedId) {
      return;
    }

    if (!hero.selectedId || !displayRows.some((row) => row.item.id === hero.selectedId)) {
      hero.setSelectedId(displayRows[0].item.id);
    }
  }, [displayRows, hero, hero.selectedId, selectionDismissed]);

  useEffect(() => {
    if (!hero.user) {
      hasAutoFocusedCaptureRef.current = false;
      return undefined;
    }

    if (hasAutoFocusedCaptureRef.current) {
      return undefined;
    }

    hasAutoFocusedCaptureRef.current = true;
    const timer = window.setTimeout(() => {
      captureInputRef.current?.focus();
      captureInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hero.user]);

  useEffect(() => {
    if (!editItemId) return undefined;
    const timer = window.setTimeout(() => {
      const input = editInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editItemId]);

  useEffect(() => {
    setProjectDrafts(
      Object.fromEntries(hero.projects.map((project) => [project.id, { name: project.name, tone: project.tone }])),
    );
  }, [hero.projects]);

  useEffect(() => {
    if (!captureProjectId || !hero.projects.some((project) => project.id === captureProjectId)) {
      setCaptureProjectId(fallbackProjectId);
    }
  }, [captureProjectId, fallbackProjectId, hero.projects]);

  useEffect(() => {
    if (editItemId && (!editProjectId || !hero.projects.some((project) => project.id === editProjectId))) {
      setEditProjectId(fallbackProjectId);
    }
  }, [editItemId, editProjectId, fallbackProjectId, hero.projects]);

  async function submitCapture(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const result = await hero.saveDraft({
      title: "",
      dueInput: "",
      captureInput,
      type: "task",
      projectId: captureProjectId || fallbackProjectId || undefined,
    });

    if (!result.ok) return toast.error(result.message);
    showActionToast(result.message);
    setCaptureInput("");
    setCaptureProjectId(fallbackProjectId);
    setSelectionDismissed(false);
  }

  async function markDone(itemId: string) {
    if (editItemId === itemId) {
      setEditItemId(null);
      blurActiveElement();
    }
    setCompletingItemId(itemId);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 520));
    const result = await hero.markDone(itemId);
    setCompletingItemId(null);
    if (!result.ok) return toast.error(result.message);
    showActionToast(result.message);
  }

  async function removeItem(itemId: string) {
    const result = await hero.removeItem(itemId);
    if (!result.ok) return toast.error(result.message);
    showActionToast(result.message);
  }

  async function applyMove(itemId: string, targetId: string, mode: MoveMode) {
    const result = await hero.moveItem(itemId, targetId, mode);
    if (!result.ok) return toast.error(result.message);
    showActionToast(result.message);
    setGrabbedItemId(null);
    setDraggedItemId(null);
  }

  async function submitRename(itemId: string) {
    const result = await hero.editCapture(itemId, editValue, editProjectId || fallbackProjectId || undefined);
    if (!result.ok) return toast.error(result.message);
    if (result.message !== "No changes.") {
      showActionToast(result.message);
    }
    setEditItemId(null);
    setMenuItemId(null);
    blurActiveElement();
  }

  async function submitProjectUpdate(projectId: string) {
    const draft = projectDrafts[projectId];
    if (!draft) return;
    const result = await hero.updateProject(projectId, draft);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
  }

  async function submitProjectCreate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const result = await hero.addProject(newProjectName, newProjectTone);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    setNewProjectName("");
    setNewProjectTone("moss");
  }

  async function setDefaultProject(projectId: string) {
    const result = await hero.setDefaultProject(projectId);
    if (!result.ok) return toast.error(result.message);
    setCaptureProjectId(projectId);
    toast.success(result.message);
  }

  async function submitReschedule(itemId: string) {
    const result = await hero.rescheduleItem(itemId, rescheduleValue);
    if (!result.ok) return toast.error(result.message);
    showActionToast(result.message);
    setRescheduleItemId(null);
    setMenuItemId(null);
    blurActiveElement();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!hero.user) return;

      if (event.key === "Escape") {
        event.preventDefault();

        if (isEditingField(document.activeElement)) {
          setShowHelp(false);
          setEditItemId(null);
          setRescheduleItemId(null);
          setMenuItemId(null);
          blurActiveElement();
          return;
        }

        dismissFocusState();
        return;
      }

      const usesShortcutModifier = (event.metaKey || event.ctrlKey) && event.shiftKey;
      if (usesShortcutModifier && selectedRow && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void markDone(selectedRow.item.id);
        return;
      }
      if (usesShortcutModifier && selectedRow && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        void removeItem(selectedRow.item.id);
        return;
      }

      if (isEditingField(event.target)) return;

      if (event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        focusCaptureComposer();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        focusCaptureComposer();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        cyclePrimaryRoute(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShowHelp((current) => !current);
        return;
      }

      if (!displayRows.length || !selectedRow) return;

      if (event.key === "j" || event.key === "J" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1, { enterEdit: true });
        return;
      }

      if (event.key === "k" || event.key === "K" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1, { enterEdit: true });
        return;
      }

      if ((event.key === " " || event.code === "Space") && listMode === "today") {
        event.preventDefault();
        setGrabbedItemId((current) => (current === selectedRow.item.id ? null : selectedRow.item.id));
        setMenuItemId(null);
        setSelectionDismissed(false);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();

        if (grabbedItemId && grabbedItemId !== selectedRow.item.id && listMode === "today") {
          void applyMove(grabbedItemId, selectedRow.item.id, event.shiftKey ? "after" : "chain");
          return;
        }

        navigate(`/due/${selectedRow.item.id}`);
        return;
      }

      if (event.key === "z" || event.key === "Z" || event.key === "u" || event.key === "U") {
        event.preventDefault();
        void hero.undoLastAction().then((result) => {
          if (!result.ok) return toast.error(result.message);
          showActionToast(result.message);
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayRows, grabbedItemId, hero, listMode, location, navigate, selectedIndex, selectedRow, editItemId, rescheduleItemId]);

  if (!hero.authChecked) {
    return <main className="min-h-screen bg-[#f6f6f3]" />;
  }

  if (!hero.user) {
    return <AuthShell onSignIn={hero.signInWithPassword} onSignUp={hero.signUpWithPassword} />;
  }

  return (
    <main className="min-h-screen bg-[#f6f6f3] px-3 py-3 text-black sm:px-4">
<div className="mx-auto max-w-5xl">
        <section className="border border-black bg-white shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
          <header className="border-b border-black px-3 py-3 sm:px-4">
              <div className="relative flex flex-wrap items-center justify-between gap-3">
	              <div className="flex items-center gap-3 text-sm font-semibold">
	                <img src={heroLogo} alt="Hero logo" className="h-8 w-8 rounded-[12px]" />
	                <span className="text-[15px] uppercase tracking-[0.18em]">Hero</span>
	              </div>


              <nav className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-black/58">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className={listMode === "today" ? "text-black" : "hover:text-black"}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/all")}
                  className={listMode === "all" ? "text-black" : "hover:text-black"}
                >
                  All
                </button>
                <button type="button" onClick={() => navigate("/analytics")} className="hover:text-black">
                  Analytics
                </button>
                <button type="button" onClick={() => navigate("/done")} className="hover:text-black">
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => setShowProjects((current) => !current)}
                  className="inline-flex min-h-7 items-center justify-center border border-black px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-black"
                >
                  Projects
                </button>
                <button
                  type="button"
                  onClick={() => setShowHelp((current) => !current)}
                  className="inline-flex h-7 w-7 items-center justify-center border border-black text-[13px] font-semibold text-black"
                  aria-label="Show help"
                >
                  ?
                </button>
              </nav>

              {showProjects ? (
                <div className="mt-4 border border-black/12 bg-[#f7f6f1] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-black/55">Projects</div>
                      <div className="mt-1 text-black/72">Set a default project and keep every task tied to a color-coded lane.</div>
                    </div>
                    <button type="button" onClick={() => setShowProjects(false)} className="text-xs uppercase tracking-[0.14em] text-black/58 hover:text-black">
                      close
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    {hero.projects.map((project) => {
                      const draft = projectDrafts[project.id] ?? { name: project.name, tone: project.tone };
                      const isDefault = hero.defaultProjectId === project.id;
                      return (
                        <div key={project.id} className="grid gap-2 border-b border-black/8 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_150px_auto] sm:items-center">
                          <label className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-black/58">
                            <input type="radio" name="default-project" checked={isDefault} onChange={() => void setDefaultProject(project.id)} />
                            <span>Default</span>
                          </label>
                          <label className="flex items-center gap-2 border border-black/12 bg-white px-3 py-2">
                            <ProjectDot tone={draft.tone} />
                            <input
                              value={draft.name}
                              onChange={(event) =>
                                setProjectDrafts((current) => ({
                                  ...current,
                                  [project.id]: { ...draft, name: event.target.value },
                                }))
                              }
                              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                          </label>
                          <select
                            value={draft.tone}
                            onChange={(event) =>
                              setProjectDrafts((current) => ({
                                ...current,
                                [project.id]: { ...draft, tone: event.target.value as ProjectTone },
                              }))
                            }
                            className="min-h-10 border border-black/12 bg-white px-3 text-sm outline-none"
                          >
                            {projectToneOptions.map((tone) => (
                              <option key={tone} value={tone}>
                                {toneLabelMap[tone]}
                              </option>
                            ))}
                          </select>
                          <button type="button" onClick={() => void submitProjectUpdate(project.id)} className="min-h-10 border border-black px-3 text-xs font-semibold uppercase tracking-[0.14em]">
                            Save
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={submitProjectCreate} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                    <input
                      value={newProjectName}
                      onChange={(event) => setNewProjectName(event.target.value)}
                      placeholder="Add a project"
                      className="min-h-10 border border-black bg-white px-3 text-sm outline-none"
                    />
                    <select
                      value={newProjectTone}
                      onChange={(event) => setNewProjectTone(event.target.value as ProjectTone)}
                      className="min-h-10 border border-black bg-white px-3 text-sm outline-none"
                    >
                      {projectToneOptions.map((tone) => (
                        <option key={tone} value={tone}>
                          {toneLabelMap[tone]}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="min-h-10 border border-black bg-black px-4 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                      Add project
                    </button>
                  </form>
                </div>
              ) : null}

              {showHelp ? <HelpPanel onClose={() => setShowHelp(false)} onSignOut={() => void hero.signOut()} /> : null}
            </div>

            <form onSubmit={submitCapture} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
              <input
                ref={captureInputRef}
                value={captureInput}
                onFocus={() => setCaptureFocused(true)}
                onBlur={() => setCaptureFocused(false)}
                onChange={(event) => setCaptureInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    dismissFocusState();
                    return;
                  }
                  if (event.key === "Tab") {
                    event.preventDefault();
                    cyclePrimaryRoute(event.shiftKey ? -1 : 1);
                    return;
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    if (displayRows.length) {
                      const target = selectedRow?.item ?? displayRows[0].item;
                      selectItem(target.id, { fromListNavigation: true });
                      beginItemEdit(target);
                    }
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (displayRows.length) {
                      const target = selectedRow?.item ?? displayRows[displayRows.length - 1].item;
                      selectItem(target.id, { fromListNavigation: true });
                      beginItemEdit(target);
                    }
                    return;
                  }
                  if (event.key === "?" && captureInput.trim() === "") {
                    event.preventDefault();
                    setShowHelp((current) => !current);
                  }
                }}
                placeholder="follow up with Katherine tomorrow 9am"
                className="min-h-11 w-full border border-black bg-white px-3 text-[15px] outline-none"
              />
              <select
                ref={captureProjectRef}
                value={captureProjectId}
                onChange={(event) => setCaptureProjectId(event.target.value)}
                className="min-h-11 border border-black bg-white px-3 text-sm outline-none"
              >
                {hero.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center border border-black bg-black px-4 text-xs font-semibold uppercase tracking-[0.16em] text-white"
              >
                Add
              </button>
            </form>

            <div className="mt-2 flex flex-col gap-1 text-xs text-black/68 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {captureInput.trim()
                  ? capturePreview || "Type the task together with a wake-up time, like “call Daniel tomorrow 8am”."
                  : "One line only: task name plus wake-up time."}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span>{hero.doneTodayCount} done today</span>
                <span>{hero.overdueCount} overdue</span>
                <span>{hero.streak} day streak</span>
              </div>
            </div>

            {parsedCapture ? (
              <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-black/52">
                Saving as “{parsedCapture.title}”
              </div>
            ) : null}
          </header>

          <div className="divide-y divide-black/10">
            {displayRows.map((row) => {
              const isSelected = hero.selectedId === row.item.id && !captureFocused;
              const isEditingRow = editItemId === row.item.id;
              const isCompletingRow = completingItemId === row.item.id;
              const project = projectById.get(resolveProjectId(row.item.projectId));
              const projectName = project?.name ?? null;
              const projectTone = project?.tone ?? "ink";
              const canDrop = Boolean((draggedItemId || grabbedItemId) && row.item.id !== draggedItemId && row.item.id !== grabbedItemId);
              const sourceId = draggedItemId || grabbedItemId;
              const actionsDimmed = isTyping && !isEditingRow;
              const rowClass = `${isSelected ? "bg-black/[0.035]" : "bg-white"} ${isCompletingRow ? "hero-row-completing" : ""}`.trim();

              return (
                <article key={row.item.id} className={rowClass}>
                  <div className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:px-4">
                      <button
                        type="button"
                        onMouseEnter={() => {
                          if (!editItemId && !rescheduleItemId) {
                            selectItem(row.item.id, { fromListNavigation: true });
                          }
                        }}
                        onClick={() => selectItem(row.item.id, { fromListNavigation: true })}
                        className="pt-1 text-left text-[11px] leading-5 text-black/58 sm:text-xs"
                      >

                      {dueLabelForList(row.item.dueAt)}
                    </button>

                    <div className="min-w-0">
                      {isEditingRow ? (
                        <div className="flex w-full items-start gap-3">
                          <span className="mt-[5px] flex items-center gap-2 text-[10px] text-black/38">
                            {row.depth > 0 ? <span>↳</span> : <span className="sr-only">Root task</span>}
                            <ProjectDot tone={projectTone} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <input
                              ref={editInputRef}
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void submitRename(row.item.id);
                                  return;
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setEditValue(row.item.title);
                                  exitInlineEdit();
                                  return;
                                }
                                if (event.key === "Tab") {
                                  event.preventDefault();
                                  cyclePrimaryRoute(event.shiftKey ? -1 : 1);
                                  return;
                                }
                                if (event.key === "ArrowDown") {
                                  event.preventDefault();
                                  void commitInlineEditIfNeeded().then(() => moveSelection(1, { enterEdit: true }));
                                  return;
                                }
                                if (event.key === "ArrowUp") {
                                  event.preventDefault();
                                  void commitInlineEditIfNeeded().then(() => moveSelection(-1, { enterEdit: true }));
                                  return;
                                }
                              }}
                              className="block w-full border-0 bg-transparent p-0 text-[15px] leading-6 text-black outline-none"
                            />
                            {editParsed ? (
                              <span className="mt-1 block text-[11px] text-black/45">Will save as “{editParsed.title}” · {editPreview}</span>
                            ) : projectName ? (
                              <span className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-black/45">{projectName}</span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          draggable={listMode === "today"}
                          onMouseEnter={() => {
                            if (!editItemId && !rescheduleItemId) {
                              selectItem(row.item.id, { fromListNavigation: true });
                            }
                          }}
                          onDragStart={() => setDraggedItemId(row.item.id)}
                          onDragEnd={() => setDraggedItemId(null)}
                          onDragOver={(event) => {
                            if (!canDrop || listMode !== "today") return;
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            if (!sourceId || listMode !== "today") return;
                            event.preventDefault();
                            void applyMove(sourceId, row.item.id, "chain");
                          }}
                          onClick={() => selectItem(row.item.id, { fromListNavigation: true })}
                          onDoubleClick={() => beginItemEdit(row.item)}
                          className="flex w-full items-start gap-3 text-left"
                        >
                          <span className="mt-[5px] flex items-center gap-2 text-[10px] text-black/38">
                            {row.depth > 0 ? <span>↳</span> : <span className="sr-only">Root task</span>}
                            <ProjectDot tone={projectTone} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="hero-title-text block break-words text-[15px] leading-6 text-black">{row.item.title}</span>
                            {projectName ? <span className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-black/45">{projectName}</span> : null}
                          </span>
                          {isCompletingRow ? (
                            <span className="relative ml-2 mt-1 inline-flex h-6 w-6 items-center justify-center">
                              <span className="hero-done-burst absolute inset-0 rounded-full bg-emerald-400/60" />
                              <span className="hero-done-check-mark relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold shadow-[0_6px_18px_rgba(5,150,105,0.35)]">
                                ✓
                              </span>
                            </span>
                          ) : null}
                        </button>
                      )}

                      {menuItemId === row.item.id ? (
                        <div className="mt-2 border-l border-black/15 pl-6 text-xs text-black/72">
                          {rescheduleItemId === row.item.id ? (
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                              <input
                                autoFocus
                                value={rescheduleValue}
                                onChange={(event) => setRescheduleValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void submitReschedule(row.item.id);
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    setRescheduleItemId(null);
                                    blurActiveElement();
                                  }
                                }}
                                className="min-h-10 flex-1 border border-black px-3 text-sm outline-none"
                              />
                              <button type="button" onClick={() => void submitReschedule(row.item.id)} className="min-h-10 border border-black px-3">
                                Save
                              </button>
                            </div>
                          ) : null}

                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => beginItemEdit(row.item)}
                              className="border border-black px-2 py-1"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRescheduleItemId(row.item.id);
                                setRescheduleValue("tomorrow 9am");
                                setEditItemId(null);
                              }}
                              className="border border-black px-2 py-1"
                            >
                              Reschedule
                            </button>
                            {listMode === "today" ? (
                              <button
                                type="button"
                                onClick={() => setGrabbedItemId((current) => (current === row.item.id ? null : row.item.id))}
                                className="border border-black px-2 py-1"
                              >
                                {grabbedItemId === row.item.id ? "Cancel move" : "Move"}
                              </button>
                            ) : null}
                            <button type="button" onClick={() => navigate(`/due/${row.item.id}`)} className="border border-black px-2 py-1">
                              Focus
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {canDrop && listMode === "today" ? (
                        <div
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            if (!sourceId) return;
                            event.preventDefault();
                            void applyMove(sourceId, row.item.id, "after");
                          }}
                          className="mt-2 flex flex-wrap gap-2 pl-6 text-[11px] uppercase tracking-[0.14em] text-black/48"
                        >
                          <button type="button" onClick={() => void applyMove(sourceId!, row.item.id, "chain")} className="border border-dashed border-black px-2 py-1 hover:border-solid hover:bg-black hover:text-white">
                            Drop under
                          </button>
                          <button type="button" onClick={() => void applyMove(sourceId!, row.item.id, "after")} className="border border-dashed border-black px-2 py-1 hover:border-solid hover:bg-black hover:text-white">
                            Drop after
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className={`flex items-center gap-1 pl-1 transition-opacity ${actionsDimmed ? "pointer-events-none opacity-30" : ""}`} aria-hidden={actionsDimmed || undefined}>
                      <button
                        type="button"
                        disabled={actionsDimmed || isCompletingRow}
                        onClick={() => void markDone(row.item.id)}
                        className="inline-flex h-9 min-w-[74px] items-center justify-center gap-1 border border-black/22 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-black/60 transition hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed"
                        aria-label="Mark task as done"
                        title="Mark task as done"
                      >
                        <span aria-hidden="true">✓</span>
                        <span>Done</span>
                      </button>
                      <button
                        type="button"
                        disabled={actionsDimmed}
                        onClick={() => void removeItem(row.item.id)}
                        className="inline-flex h-9 w-9 items-center justify-center border border-black/18 text-black/45 hover:border-black hover:text-black disabled:cursor-not-allowed"
                        aria-label="Delete task"
                      >
                        🗑
                      </button>
                      <button
                        type="button"
                        disabled={actionsDimmed}
                        onClick={() => setMenuItemId((current) => (current === row.item.id ? null : row.item.id))}
                        className="inline-flex h-9 w-9 items-center justify-center border border-black/18 text-black/45 hover:border-black hover:text-black disabled:cursor-not-allowed"
                        aria-label="More actions"
                      >
                        …
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {displayRows.length === 0 ? (
              <div className="px-4 py-12 text-sm leading-7 text-black/62">
                {listMode === "today"
                  ? "Nothing is due today yet. Add one line above, with a task and its wake-up time."
                  : "No upcoming tasks. Add a task with its wake-up time and it will appear here."}
              </div>
            ) : null}
          </div>

          <footer className="border-t border-black px-3 py-3 sm:px-4">
            <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-black">
              {grabbedItemId
                ? "Move mode"
                : rescheduleItemId
                  ? "Rescheduling task"
                  : editItemId
                    ? "Editing task"
                    : captureFocused
                      ? "Typing new task"
                      : hero.selectedId
                        ? "Navigating task list"
                        : "Idle"}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-black/48">
              {grabbedItemId
                ? "Drop under a task to create a chain, or drop after to reorder it."
                : rescheduleItemId
                  ? "Type a new wake-up time · Enter saves · Escape cancels."
                  : editItemId
                    ? "Enter saves · Escape exits edit · ↑ / ↓ move to the next task · ⇧⌘D to mark done · ⇧⌘⌫ to delete."
                    : captureFocused
                      ? "Enter saves · Escape clears focus · ↓ jumps into the first task."
                      : "Press T for a new task · ↑ / ↓ edit as you browse · Escape returns to shortcuts · ? for help."}
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
