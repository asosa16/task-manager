/*
Design note for this file:
- Re-center Task Man on the original extension ritual: one line in, one calm list out.
- Keep the surface sparse and monochrome; secondary actions should stay hidden until asked for.
- Today is the default home, while All and Analytics stay lightweight and adjacent rather than competing for attention.
- Every project is its own container, all visible at once. Each container has its own one-line
  composer (Enter saves; a missing wake-up time defaults to five minutes from now, no second
  press). A task's project is the container it sits in — there is no project dropdown anywhere;
  moving between projects is drag and drop (onto a row to slot below it in that project, onto the
  container background to just change project) or the keyboard grab. Navigation walks all
  containers in order.
*/
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Star, Trophy } from "lucide-react";
import {
  formatDueLabel,
  parseCaptureInput,
  previewCaptureInput,
  toneColorMap,
  toneLabelMap,
  useHeroApp,
  type HeroItem,
  type ProjectTone,
  type SyncStatus,
} from "@/hooks/useHeroApp";

const STAR_GOLD = "#c8941f";
const UNSORTED_COLUMN_ID = "";

const heroLogo = "/hero-logo.png";

const primaryRouteOrder = ["/", "/tomorrow", "/all", "/done"] as const;
const projectToneOptions: ProjectTone[] = ["moss", "slate", "amber", "clay", "ink"];

function getPrimaryRouteTarget(currentPath: string, direction: 1 | -1) {
  const current = primaryRouteOrder.includes(currentPath as (typeof primaryRouteOrder)[number])
    ? (currentPath as (typeof primaryRouteOrder)[number])
    : "/";
  const index = primaryRouteOrder.indexOf(current);
  return primaryRouteOrder[(index + direction + primaryRouteOrder.length) % primaryRouteOrder.length];
}

type ListMode = "today" | "tomorrow" | "all";
type DisplayRow = {
  item: HeroItem;
  depth: number;
  parentId?: string;
};
type Column = {
  id: string;
  name: string;
  tone: ProjectTone;
  rows: DisplayRow[];
  isVirtual: boolean;
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

function isDueTomorrow(input: string) {
  const date = new Date(input);
  const startOfTomorrow = new Date();
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  startOfTomorrow.setHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(startOfTomorrow);
  endOfTomorrow.setHours(23, 59, 59, 999);
  const time = date.getTime();
  return time >= startOfTomorrow.getTime() && time <= endOfTomorrow.getTime();
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

function syncStatusLabel(status: SyncStatus) {
  switch (status) {
    case "pending":
      return "saving…";
    case "syncing":
      return "syncing…";
    case "offline":
      return "offline · saved on this device";
    case "error":
      return "sync paused · database not ready";
    default:
      return "synced";
  }
}

function ProjectDot({ tone }: { tone: ProjectTone }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/15" style={{ backgroundColor: toneColorMap[tone] }} />;
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 500);
    return () => window.clearInterval(id);
  }, []);
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const isBlinkOn = now.getMilliseconds() < 500;
  const padded = (value: number) => value.toString().padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = ((hours + 11) % 12) + 1;
  const label = `${padded(displayHours)}:${padded(minutes)} ${suffix}`;
  return (
    <time
      dateTime={now.toISOString()}
      aria-label={`Current time ${label}`}
      className="inline-flex items-baseline gap-2 font-serif leading-none"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <span className="inline-flex items-baseline text-[18px] tracking-tight text-black sm:text-[22px]">
        <span>{padded(displayHours)}</span>
        <span
          aria-hidden="true"
          className="mx-[2px] transition-opacity duration-150"
          style={{ opacity: isBlinkOn ? 1 : 0.15 }}
        >
          :
        </span>
        <span>{padded(minutes)}</span>
        <span className="ml-[2px] hidden text-[10px] uppercase tracking-[0.24em] text-black/40 sm:inline" style={{ fontFamily: "system-ui" }}>
          :{padded(seconds)}
        </span>
        <span className="ml-2 text-[10px] uppercase tracking-[0.22em] text-black/55 sm:text-[11px]">{suffix}</span>
      </span>
    </time>
  );
}

function ColorPalette({
  value,
  onChange,
  size = "md",
}: {
  value: ProjectTone;
  onChange: (tone: ProjectTone) => void;
  size?: "sm" | "md";
}) {
  const dimension = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="Project color">
      {projectToneOptions.map((tone) => {
        const selected = tone === value;
        return (
          <button
            key={tone}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(tone)}
            aria-label={toneLabelMap[tone]}
            title={toneLabelMap[tone]}
            className={`${dimension} rounded-full border transition ${
              selected
                ? "border-black ring-2 ring-offset-2 ring-black/25"
                : "border-black/20 hover:border-black/60"
            }`}
            style={{ backgroundColor: toneColorMap[tone] }}
          />
        );
      })}
    </div>
  );
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
        <div className="flex items-center justify-between gap-3"><span>focus the new-task line</span><span className="font-semibold">T <span className="text-black/40">/ ⇧N</span></span></div>
        <div className="flex items-center justify-between gap-3"><span>save the new task</span><span className="font-semibold">Enter</span></div>
        <div className="text-[10px] leading-4 text-black/40">Each project has its own line. No wake-up time? It wakes up in 5 minutes.</div>

        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-black/45">List navigation</div>
        <div className="flex items-center justify-between gap-3"><span>edit &amp; move through tasks</span><span className="font-semibold">↑ / ↓</span></div>
        <div className="flex items-center justify-between gap-3"><span>save inline edit</span><span className="font-semibold">Enter</span></div>
        <div className="flex items-center justify-between gap-3"><span>exit edit, keep selection</span><span className="font-semibold">Esc</span></div>
        <div className="flex items-center justify-between gap-3"><span>switch Today / Tomorrow / All / Done</span><span className="font-semibold">Tab</span></div>

        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-black/45">Act on selected task</div>
        <div className="flex items-center justify-between gap-3"><span>mark done</span><span className="font-semibold">⇧⌘D</span></div>
        <div className="flex items-center justify-between gap-3"><span>delete</span><span className="font-semibold">⇧⌘⌫</span></div>
        <div className="flex items-center justify-between gap-3"><span>star / unstar (max 3)</span><span className="font-semibold">⇧⌘1</span></div>
        <div className="flex items-center justify-between gap-3"><span>activate hovered task (tunnel)</span><span className="font-semibold">⇧⌘A</span></div>
        <div className="flex items-center justify-between gap-3"><span>exit active task</span><span className="font-semibold">Esc</span></div>
        <div className="flex items-center justify-between gap-3"><span>undo last action (after Esc)</span><span className="font-semibold">Z <span className="text-black/40">/ U</span></span></div>

        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-black/45">Reorder &amp; move (after Esc)</div>
        <div className="flex items-center justify-between gap-3"><span>pick up the task</span><span className="font-semibold">Space</span></div>
        <div className="flex items-center justify-between gap-3"><span>drop after another task</span><span className="font-semibold">Enter</span></div>
        <div className="text-[10px] leading-4 text-black/40">Dropping slots the task directly below the one above it, in that project. Drag with the mouse for the same effect, or drag onto a project's empty space to move it there without retiming.</div>

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
  onSendMagicLink,
}: {
  onSendMagicLink: (email: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    return params.has("error")
      ? "This sign-in link is invalid or has expired. Request a new link below."
      : "";
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const result = await onSendMagicLink(email);
      if (!result.ok) setError(result.message);
      else setNotice(result.message);
    } catch {
      setError("Could not send the sign-in link. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f6f3] px-4 py-8 text-black">
      <div className="mx-auto max-w-md border border-black bg-white p-5 shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-3 border-b border-black pb-3 text-sm font-semibold">
          <img src={heroLogo} alt="Task Man logo" className="h-7 w-7 rounded-[10px]" />
          <span className="text-[15px] uppercase tracking-[0.18em]">Task Man</span>
        </div>
        <div className="mt-5 space-y-2">
          <h1 className="text-[24px] font-semibold leading-none">Sign in to Task Man.</h1>
          <p className="text-sm leading-6 text-black/68">
            Enter your email and we’ll send you a magic link. No password needed.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="mt-5 space-y-3" aria-busy={sending}>
          <label htmlFor="signin-email" className="block text-sm font-medium">Email</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            required
            disabled={sending}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="min-h-11 w-full border border-black bg-white px-3 text-sm outline-none"
          />
          <button type="submit" disabled={sending} className="inline-flex min-h-11 w-full items-center justify-center border border-black bg-black px-4 text-sm text-white disabled:cursor-wait disabled:opacity-60">
            {sending ? "Sending…" : notice ? "Send another link" : "Send magic link"}
          </button>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {notice && (
            <div role="status" className="space-y-1 text-sm leading-6 text-black/68">
              <p>{notice}</p>
              <p>Open the link to sign in. If it hasn’t arrived, check your spam folder.</p>
            </div>
          )}
        </form>
        <p className="mt-3 text-xs leading-5 text-black/68">
          Use your existing account email to access your tasks. New to Task Man? Your first link creates your account.
        </p>
      </div>
    </main>
  );
}

export default function Home() {
  const hero = useHeroApp();
  const [location, navigate] = useLocation();
  const listMode: ListMode =
    location === "/all" ? "all" : location === "/tomorrow" ? "tomorrow" : "today";

  // One composer per project container, keyed by project id ("" = Unsorted).
  const [captureInputs, setCaptureInputs] = useState<Record<string, string>>({});
  const [captureFocusedColumnId, setCaptureFocusedColumnId] = useState<string | null>(null);
  const [captureSavingColumnId, setCaptureSavingColumnId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [rescheduleItemId, setRescheduleItemId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("tomorrow 9am");
  const [grabbedItemId, setGrabbedItemId] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  // The row a dragged task is currently hovering over — highlighted as the
  // drop target. Dropping onto it sets the dragged task's wake-up time to one
  // minute after this row's, sliding it directly below (and into its project).
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  // The container the cursor is over. When no row is hovered, the container
  // itself is the target: dropping moves the task into that project as-is.
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [selectionDismissed, setSelectionDismissed] = useState(false);
  const [leavingRow, setLeavingRow] = useState<{
    row: DisplayRow;
    columnId: string;
    originalIndex: number;
    phase: "celebrate" | "dispatch";
    kind: "done" | "delete";
  } | null>(null);
  const [holdingDoneItemId, setHoldingDoneItemId] = useState<string | null>(null);
  const [confettiBursts, setConfettiBursts] = useState<
    Array<{ id: string; x: number; y: number; kind: "done" | "delete" }>
  >([]);
  // Keys of in-flight per-item mutations, e.g. "done:<uuid>". Buttons disable
  // while the key is present so the user can't double-submit a mark-done while
  // the store write is still pending, and markDone's confetti / row animation
  // only fire once the await resolves — no optimistic UI.
  const [pendingMutations, setPendingMutations] = useState<Set<string>>(() => new Set());
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [projectDrafts, setProjectDrafts] = useState<Record<string, { name: string; tone: ProjectTone }>>({});
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTone, setNewProjectTone] = useState<ProjectTone>("moss");
  const captureInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const hasAutoFocusedCaptureRef = useRef(false);
  const doneButtonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const holdDoneTimerRef = useRef<number | null>(null);
  const celebrateTimerRef = useRef<number | null>(null);
  const dispatchTimerRef = useRef<number | null>(null);

  const filteredItems = useMemo(() => {
    if (listMode === "today") return hero.upcomingItems.filter((item) => isDueTodayOrOverdue(item.dueAt));
    if (listMode === "tomorrow") return hero.upcomingItems.filter((item) => isDueTomorrow(item.dueAt));
    return hero.upcomingItems;
  }, [hero.upcomingItems, listMode]);

  const projectById = useMemo(() => new Map(hero.projects.map((project) => [project.id, project])), [hero.projects]);
  const fallbackProjectId = hero.defaultProjectId ?? hero.projects[0]?.id ?? "";

  // One container per project, in project order. Items whose project is
  // missing land in the default project (matching how the hook resolves them
  // on save); if there is no project to fall back to, an "Unsorted" container
  // appears so nothing is ever hidden.
  const columns = useMemo<Column[]>(() => {
    const byColumn = new Map<string, HeroItem[]>();
    filteredItems.forEach((item) => {
      const key = item.projectId && projectById.has(item.projectId) ? item.projectId : fallbackProjectId;
      const bucket = byColumn.get(key) ?? [];
      bucket.push(item);
      byColumn.set(key, bucket);
    });

    const result: Column[] = hero.projects.map((project) => ({
      id: project.id,
      name: project.name,
      tone: project.tone,
      rows: buildDisplayRows(byColumn.get(project.id) ?? []),
      isVirtual: false,
    }));

    const orphans = Array.from(byColumn.entries())
      .filter(([key]) => !projectById.has(key))
      .flatMap(([, bucket]) => bucket);
    if (orphans.length || result.length === 0) {
      result.push({
        id: UNSORTED_COLUMN_ID,
        name: "Unsorted",
        tone: "ink",
        rows: buildDisplayRows(orphans),
        isVirtual: true,
      });
    }
    return result;
  }, [fallbackProjectId, filteredItems, hero.projects, projectById]);

  const displayRows = useMemo(() => columns.flatMap((column) => column.rows), [columns]);
  const columnIdByItemId = useMemo(() => {
    const map = new Map<string, string>();
    columns.forEach((column) => column.rows.forEach((row) => map.set(row.item.id, column.id)));
    return map;
  }, [columns]);
  const focusLockId = holdingDoneItemId ?? (leavingRow?.phase === "celebrate" ? leavingRow.row.item.id : null);
  const selectedIndex = useMemo(() => displayRows.findIndex((row) => row.item.id === hero.selectedId), [displayRows, hero.selectedId]);
  const selectedRow = selectedIndex >= 0 ? displayRows[selectedIndex] : displayRows[0] ?? null;
  const editParsed = useMemo(() => (editItemId ? parseCaptureInput(editValue) : null), [editItemId, editValue]);
  const editPreview = useMemo(() => (editItemId ? previewCaptureInput(editValue) : ""), [editItemId, editValue]);
  const captureFocused = captureFocusedColumnId !== null;
  const isTyping = editItemId !== null || rescheduleItemId !== null || captureFocused;

  function showActionToast(message: string) {
    toast.success(`${message} Press Z to undo.`);
  }

  function resolveProjectId(projectId?: string | null) {
    return projectId && projectById.has(projectId) ? projectId : fallbackProjectId;
  }

  function columnIdForItem(item: HeroItem) {
    return columnIdByItemId.get(item.id) ?? resolveProjectId(item.projectId);
  }

  function rowsForColumn(column: Column) {
    if (!leavingRow || leavingRow.columnId !== column.id) return column.rows;
    if (column.rows.some((r) => r.item.id === leavingRow.row.item.id)) return column.rows;
    const insertAt = Math.min(leavingRow.originalIndex, column.rows.length);
    const merged = column.rows.slice();
    merged.splice(insertAt, 0, leavingRow.row);
    return merged;
  }

  function beginItemEdit(item: HeroItem, options?: { openMenu?: boolean }) {
    setSelectionDismissed(false);
    if (options?.openMenu) setMenuItemId(item.id);
    setRescheduleItemId(null);
    setEditItemId(item.id);
    setEditValue(item.title);
    hero.setSelectedId(item.id);
  }

  function isComposerFocusTarget(target: EventTarget | null) {
    return Array.from(captureInputRefs.current.values()).some((input) => input !== null && input === target);
  }

  function releaseComposerFocus() {
    if (isComposerFocusTarget(document.activeElement)) {
      blurActiveElement();
    }
  }

  function focusCaptureComposer(columnId?: string) {
    setSelectionDismissed(false);
    setShowHelp(false);
    setMenuItemId(null);
    setGrabbedItemId(null);
    setDraggedItemId(null);
    setDragOverItemId(null);
    setDragOverColumnId(null);
    const preferred =
      columnId ?? (selectedRow ? columnIdForItem(selectedRow.item) : fallbackProjectId);
    window.setTimeout(() => {
      const input =
        captureInputRefs.current.get(preferred) ??
        Array.from(captureInputRefs.current.values()).find((candidate) => Boolean(candidate)) ??
        null;
      input?.focus();
      input?.select();
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
    if (!titleChanged && !dueChanged) return;
    // The task's project is its container; inline edit never changes it.
    const result = await hero.editCapture(itemId, trimmed, resolveProjectId(target.projectId) || undefined);
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

  function clearDragState() {
    setGrabbedItemId(null);
    setDraggedItemId(null);
    setDragOverItemId(null);
    setDragOverColumnId(null);
  }

  function dismissFocusState() {
    setShowHelp(false);
    setMenuItemId(null);
    setEditItemId(null);
    setRescheduleItemId(null);
    clearDragState();
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
      const input =
        captureInputRefs.current.get(fallbackProjectId) ??
        Array.from(captureInputRefs.current.values()).find((candidate) => Boolean(candidate)) ??
        null;
      input?.focus();
      input?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fallbackProjectId, hero.user]);

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

  // One Enter saves. With a parseable wake-up time the task uses it; without
  // one it wakes up in five minutes. No confirmation step, no second press.
  async function submitCapture(columnId: string, event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (captureSavingColumnId === columnId) {
      toast("Still saving — hang on a sec.", { duration: 2000 });
      return;
    }
    const trimmed = (captureInputs[columnId] ?? "").trim();
    if (!trimmed) return;

    const parsed = parseCaptureInput(trimmed);
    const projectId = columnId || fallbackProjectId || undefined;

    setCaptureSavingColumnId(columnId);
    try {
      const result = parsed
        ? await hero.saveDraft({
            title: "",
            dueInput: "",
            captureInput: trimmed,
            type: "task",
            projectId,
          })
        : await hero.saveDraft({
            title: trimmed,
            dueInput: "in 5 minutes",
            type: "task",
            projectId,
          });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      showActionToast(result.message);
      setCaptureInputs((current) => ({ ...current, [columnId]: "" }));
      setSelectionDismissed(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save task. Try again.");
    } finally {
      setCaptureSavingColumnId((current) => (current === columnId ? null : current));
    }
  }

  function cancelHoldDone() {
    if (holdDoneTimerRef.current !== null) {
      window.clearTimeout(holdDoneTimerRef.current);
      holdDoneTimerRef.current = null;
    }
    setHoldingDoneItemId(null);
  }

  function startHoldDone(itemId: string) {
    if (holdDoneTimerRef.current !== null) return;
    setHoldingDoneItemId(itemId);
    holdDoneTimerRef.current = window.setTimeout(() => {
      holdDoneTimerRef.current = null;
      setHoldingDoneItemId(null);
      void markDone(itemId);
    }, 1000);
  }

  function clearLeavingTimers() {
    if (celebrateTimerRef.current !== null) {
      window.clearTimeout(celebrateTimerRef.current);
      celebrateTimerRef.current = null;
    }
    if (dispatchTimerRef.current !== null) {
      window.clearTimeout(dispatchTimerRef.current);
      dispatchTimerRef.current = null;
    }
  }

  function locateRow(itemId: string) {
    for (const column of columns) {
      const index = column.rows.findIndex((r) => r.item.id === itemId);
      if (index >= 0) return { column, index, row: column.rows[index] };
    }
    return null;
  }

  function playLeavingAnimation(
    itemId: string,
    located: { column: Column; index: number; row: DisplayRow } | null,
    burstPosition: { x: number; y: number } | null,
    kind: "done" | "delete",
  ) {
    if (!located || !burstPosition) return;
    clearLeavingTimers();
    const burst = {
      id: `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: burstPosition.x,
      y: burstPosition.y,
      kind,
    };
    setConfettiBursts((prev) => [...prev, burst]);
    window.setTimeout(() => {
      setConfettiBursts((prev) => prev.filter((b) => b.id !== burst.id));
    }, 800);
    setLeavingRow({
      row: located.row,
      columnId: located.column.id,
      originalIndex: located.index,
      phase: "celebrate",
      kind,
    });
    celebrateTimerRef.current = window.setTimeout(() => {
      celebrateTimerRef.current = null;
      setLeavingRow((prev) =>
        prev && prev.row.item.id === itemId ? { ...prev, phase: "dispatch" } : prev,
      );
      dispatchTimerRef.current = window.setTimeout(() => {
        dispatchTimerRef.current = null;
        setLeavingRow((prev) => (prev && prev.row.item.id === itemId ? null : prev));
      }, 350);
    }, 450);
  }

  function burstPositionFor(button: HTMLButtonElement | null | undefined) {
    const rect = button?.getBoundingClientRect();
    return rect && (rect.width > 0 || rect.height > 0)
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : null;
  }

  async function markDone(itemId: string) {
    cancelHoldDone();
    if (editItemId === itemId) {
      setEditItemId(null);
      blurActiveElement();
    }

    const key = `done:${itemId}`;
    if (pendingMutations.has(key)) return;

    // Capture the row and button position BEFORE awaiting the mutation.
    // Once the mutation resolves and hero.items updates, the item leaves
    // the upcoming list and its button unmounts — the post-success
    // animation has to reference values frozen from the pre-mutation state.
    const located = locateRow(itemId);
    const burstPosition = burstPositionFor(doneButtonRefs.current.get(itemId));

    setPendingMutations((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const result = await hero.markDone(itemId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      playLeavingAnimation(itemId, located, burstPosition, "done");
      showActionToast(result.message);
    } finally {
      setPendingMutations((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function removeItem(itemId: string) {
    if (editItemId === itemId) {
      setEditItemId(null);
      blurActiveElement();
    }

    const key = `delete:${itemId}`;
    if (pendingMutations.has(key)) return;

    const located = locateRow(itemId);
    const burstPosition = burstPositionFor(deleteButtonRefs.current.get(itemId));

    setPendingMutations((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const result = await hero.removeItem(itemId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      playLeavingAnimation(itemId, located, burstPosition, "delete");
      showActionToast(result.message);
    } finally {
      setPendingMutations((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function toggleStar(itemId: string) {
    const result = await hero.toggleStar(itemId);
    if (!result.ok) return toast.error(result.message);
    showActionToast(result.message);
  }

  async function applyMove(itemId: string, targetId: string) {
    const result = await hero.moveItem(itemId, targetId);
    if (!result.ok) return toast.error(result.message);
    showActionToast(result.message);
    clearDragState();
  }

  async function applyMoveToColumn(itemId: string, columnId: string) {
    const result = await hero.moveItemToProject(itemId, columnId || undefined);
    clearDragState();
    if (!result.ok) return toast.error(result.message);
    if (result.message !== "No changes.") showActionToast(result.message);
  }

  async function submitRename(itemId: string) {
    const target = hero.items.find((item) => item.id === itemId);
    const result = await hero.editCapture(itemId, editValue, resolveProjectId(target?.projectId) || undefined);
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

        if (activeItemId) {
          setActiveItemId(null);
          return;
        }

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
      if (usesShortcutModifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const targetId = selectedRow?.item.id ?? hoveredItemId ?? null;
        if (targetId) {
          setActiveItemId(targetId);
          setEditItemId(null);
          setMenuItemId(null);
          blurActiveElement();
        }
        return;
      }
      if (usesShortcutModifier && selectedRow && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (!event.repeat) {
          startHoldDone(selectedRow.item.id);
        }
        return;
      }
      if (usesShortcutModifier && selectedRow && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        void removeItem(selectedRow.item.id);
        return;
      }
      if (usesShortcutModifier && selectedRow && (event.code === "Digit1" || event.key === "1" || event.key === "!")) {
        event.preventDefault();
        if (!event.repeat) {
          void toggleStar(selectedRow.item.id);
        }
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

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setGrabbedItemId((current) => (current === selectedRow.item.id ? null : selectedRow.item.id));
        setMenuItemId(null);
        setSelectionDismissed(false);
        return;
      }

      if (event.key === "Enter") {
        if (grabbedItemId && grabbedItemId !== selectedRow.item.id) {
          event.preventDefault();
          void applyMove(grabbedItemId, selectedRow.item.id);
          return;
        }
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
  }, [displayRows, columns, grabbedItemId, hero, listMode, location, navigate, selectedIndex, selectedRow, editItemId, rescheduleItemId, activeItemId, hoveredItemId]);

  useEffect(() => {
    function onKeyUp(event: KeyboardEvent) {
      if (holdDoneTimerRef.current === null) return;
      const key = event.key.toLowerCase();
      if (key === "shift" || key === "meta" || key === "control" || key === "d") {
        cancelHoldDone();
      }
    }
    function onBlur() {
      cancelHoldDone();
    }
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (celebrateTimerRef.current !== null) window.clearTimeout(celebrateTimerRef.current);
      if (dispatchTimerRef.current !== null) window.clearTimeout(dispatchTimerRef.current);
    };
  }, []);

  if (!hero.authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f6f3] text-black/55">
        <div
          role="status"
          aria-label="Loading Task Man"
          className="flex items-center gap-[10px] text-[11px] uppercase tracking-[0.18em]"
        >
          <span className="hero-initial-dot" />
          <span className="hero-initial-dot" style={{ animationDelay: "0.15s" }} />
          <span className="hero-initial-dot" style={{ animationDelay: "0.3s" }} />
          <span>Task Man</span>
        </div>
      </main>
    );
  }

  if (!hero.user) {
    return <AuthShell onSendMagicLink={hero.sendMagicLink} />;
  }

  const sourceId = draggedItemId || grabbedItemId;

  const emptyColumnText =
    listMode === "today"
      ? "Nothing due today."
      : listMode === "tomorrow"
        ? "Nothing due tomorrow."
        : "No upcoming tasks.";

  return (
    <main className="min-h-screen bg-[#f6f6f3] px-3 py-3 text-black sm:px-4">
      {activeItemId ? <div className="hero-tunnel-backdrop" aria-hidden="true" /> : null}
      <div className="mx-auto max-w-[1400px]">
        <section className="border border-black bg-white shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
          <header className={`border-b border-black px-3 py-3 sm:px-4 ${activeItemId ? "hero-tunnel-dim" : ""}`}>
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4 text-sm font-semibold">
                <div className="flex items-center gap-3">
                  <img src={heroLogo} alt="Task Man logo" className="h-8 w-8 rounded-[12px]" />
                  <span className="text-[15px] uppercase tracking-[0.18em]">Task Man</span>
                </div>
                <span className="hidden h-6 w-px bg-black/15 sm:inline-block" aria-hidden="true" />
                <HeaderClock />
              </div>

              <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.14em] text-black/58 sm:text-xs sm:tracking-[0.16em]">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className={listMode === "today" ? "text-black" : "hover:text-black"}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/tomorrow")}
                  className={listMode === "tomorrow" ? "text-black" : "hover:text-black"}
                >
                  Tomorrow
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
                  className="inline-flex min-h-7 items-center justify-center border border-black px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-black sm:text-[11px]"
                >
                  Projects
                </button>
                <button
                  type="button"
                  onClick={() => setShowHelp((current) => !current)}
                  className="hidden h-7 w-7 items-center justify-center border border-black text-[13px] font-semibold text-black sm:inline-flex"
                  aria-label="Show help"
                >
                  ?
                </button>
              </nav>

              {showProjects ? (
                <div className="mt-4 w-full border border-black/12 bg-[#f7f6f1] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-black/55">Projects</div>
                      <div className="mt-1 text-black/72">Each project is its own container below. The default project is where T lands and where unfiled tasks go.</div>
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
                        <div key={project.id} className="grid gap-2 border-b border-black/8 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center">
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
                          <ColorPalette
                            value={draft.tone}
                            onChange={(tone) =>
                              setProjectDrafts((current) => ({
                                ...current,
                                [project.id]: { ...draft, tone },
                              }))
                            }
                          />
                          <button type="button" onClick={() => void submitProjectUpdate(project.id)} className="min-h-10 border border-black px-3 text-xs font-semibold uppercase tracking-[0.14em]">
                            Save
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={submitProjectCreate} className="mt-4 grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <input
                      value={newProjectName}
                      onChange={(event) => setNewProjectName(event.target.value)}
                      placeholder="Add a project"
                      className="min-h-10 border border-black bg-white px-3 text-sm outline-none"
                    />
                    <ColorPalette value={newProjectTone} onChange={setNewProjectTone} />
                    <button type="submit" className="min-h-10 border border-black bg-black px-4 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                      Add project
                    </button>
                  </form>
                </div>
              ) : null}

              {showHelp ? <HelpPanel onClose={() => setShowHelp(false)} onSignOut={() => void hero.signOut()} /> : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black/68">
              <span>{hero.doneTodayCount} done today</span>
              <span>{hero.overdueCount} overdue</span>
              <span>{hero.streak} day streak</span>
              {hero.remoteReady ? (
                <span
                  className={`ml-auto text-[11px] uppercase tracking-[0.14em] ${
                    hero.syncStatus === "offline" || hero.syncStatus === "error" ? "text-amber-700" : "text-black/40"
                  }`}
                  title={hero.statusMessage}
                >
                  {syncStatusLabel(hero.syncStatus)}
                </span>
              ) : null}
            </div>
          </header>

          {/* Project containers: one per project, all visible, each with its own
              composer. Auto-fit keeps them side by side when there is room and
              stacks them on narrow screens. The 1px gap on a dark background
              draws the dividers regardless of how the grid wraps. */}
          <div className="grid gap-px bg-black/20 md:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
            {columns.map((column) => {
              const rows = rowsForColumn(column);
              const captureValue = captureInputs[column.id] ?? "";
              const parsedCapture = captureValue.trim() ? parseCaptureInput(captureValue) : null;
              const capturePreview = parsedCapture ? previewCaptureInput(captureValue) : "";
              const isCaptureFocused = captureFocusedColumnId === column.id;
              const isCaptureSaving = captureSavingColumnId === column.id;
              const isColumnDropTarget =
                Boolean(sourceId) && dragOverColumnId === column.id && dragOverItemId === null;
              const columnClass = [
                "flex min-h-[260px] flex-col bg-white",
                isColumnDropTarget ? "hero-column-drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <section
                  key={column.id || "unsorted"}
                  className={columnClass}
                  aria-label={`${column.name} tasks`}
                  onDragOver={(event) => {
                    if (!sourceId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    // Reached only when the cursor is not over a row (rows stop
                    // propagation), so the container itself is the target.
                    if (dragOverItemId !== null) setDragOverItemId(null);
                    if (dragOverColumnId !== column.id) setDragOverColumnId(column.id);
                  }}
                  onDrop={(event) => {
                    if (!sourceId) return;
                    event.preventDefault();
                    void applyMoveToColumn(sourceId, column.id);
                  }}
                >
                  <div className={`border-b border-black/10 px-3 pb-2 pt-3 ${activeItemId ? "hero-tunnel-dim" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-black">
                        <ProjectDot tone={column.tone} />
                        <span className="truncate">{column.name}</span>
                        {hero.defaultProjectId === column.id ? (
                          <span className="text-[9px] font-medium tracking-[0.14em] text-black/40">default</span>
                        ) : null}
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                        {column.rows.length}
                      </span>
                    </div>

                    <form onSubmit={(event) => void submitCapture(column.id, event)} className="mt-2 flex gap-2">
                      <input
                        ref={(el) => {
                          if (el) captureInputRefs.current.set(column.id, el);
                          else captureInputRefs.current.delete(column.id);
                        }}
                        value={captureValue}
                        onFocus={() => setCaptureFocusedColumnId(column.id)}
                        onBlur={() => setCaptureFocusedColumnId((current) => (current === column.id ? null : current))}
                        onChange={(event) =>
                          setCaptureInputs((current) => ({ ...current, [column.id]: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitCapture(column.id);
                            return;
                          }
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
                            const target = column.rows[0]?.item ?? selectedRow?.item ?? displayRows[0]?.item;
                            if (target) {
                              selectItem(target.id, { fromListNavigation: true });
                              beginItemEdit(target);
                            }
                            return;
                          }
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            const target =
                              column.rows[column.rows.length - 1]?.item ??
                              selectedRow?.item ??
                              displayRows[displayRows.length - 1]?.item;
                            if (target) {
                              selectItem(target.id, { fromListNavigation: true });
                              beginItemEdit(target);
                            }
                            return;
                          }
                          if (event.key === "?" && captureValue.trim() === "") {
                            event.preventDefault();
                            setShowHelp((current) => !current);
                          }
                        }}
                        placeholder={column.isVirtual ? "add a task" : `add to ${column.name} · optional time, e.g. tomorrow 9am`}
                        className="min-h-10 min-w-0 flex-1 border border-black bg-white px-3 text-[14px] outline-none"
                        aria-label={`New task in ${column.name}`}
                      />
                      <button
                        type="submit"
                        className="inline-flex min-h-10 shrink-0 items-center justify-center border border-black bg-black px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white"
                      >
                        Add
                      </button>
                    </form>
                    {captureValue.trim() && (isCaptureFocused || isCaptureSaving) ? (
                      <div className="mt-1.5 text-[11px] text-black/55">
                        {parsedCapture ? (
                          <>
                            {isCaptureSaving ? "Saving" : "Will save"} as “{parsedCapture.title}” · {capturePreview}
                          </>
                        ) : (
                          <>Enter saves “{captureValue.trim()}” · wakes up in 5 minutes</>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex-1 divide-y divide-black/10">
                    {rows.map((row) => {
                      const isSelected = hero.selectedId === row.item.id && !captureFocused;
                      const isEditingRow = editItemId === row.item.id;
                      const isCelebratingRow = leavingRow?.phase === "celebrate" && leavingRow.row.item.id === row.item.id;
                      const isDispatchingRow = leavingRow?.phase === "dispatch" && leavingRow.row.item.id === row.item.id;
                      const isLeavingRow = isCelebratingRow || isDispatchingRow;
                      const leavingKind = isLeavingRow ? leavingRow!.kind : null;
                      const isHoldingDoneRow = holdingDoneItemId === row.item.id;
                      const isActiveRow = activeItemId === row.item.id;
                      const isDimmed = Boolean(activeItemId) && !isActiveRow;
                      const isBystander = focusLockId !== null && focusLockId !== row.item.id;
                      const isPastDue = new Date(row.item.dueAt).getTime() < Date.now();
                      const canDrop = Boolean(sourceId) && row.item.id !== sourceId;
                      const isBeingDragged = draggedItemId === row.item.id;
                      const isGrabbed = grabbedItemId === row.item.id;
                      const isDropTarget = canDrop && dragOverItemId === row.item.id;
                      const actionsDimmed = isTyping && !isEditingRow;
                      const rowClass = [
                        isSelected ? "bg-black/[0.035]" : "bg-white",
                        isCelebratingRow ? (leavingKind === "delete" ? "hero-row-deleting-celebrate" : "hero-row-celebrating") : "",
                        isDispatchingRow ? (leavingKind === "delete" ? "hero-row-deleting-dispatching" : "hero-row-dispatching") : "",
                        isHoldingDoneRow ? "hero-row-holding-done" : "",
                        isActiveRow ? "hero-tunnel-active" : "",
                        isDimmed ? "hero-tunnel-dim" : "",
                        isBystander ? "hero-row-bystander" : "",
                        isBeingDragged || isGrabbed ? "hero-row-dragging" : "",
                        isDropTarget ? "hero-row-drop-target" : "",
                      ].filter(Boolean).join(" ");

                      return (
                        <article
                          key={row.item.id}
                          className={rowClass}
                          onMouseEnter={() => setHoveredItemId(row.item.id)}
                          onMouseLeave={() => setHoveredItemId((current) => (current === row.item.id ? null : current))}
                          onDragOver={(event) => {
                            if (!canDrop) return;
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "move";
                            // Each row claims the highlight as the cursor enters it;
                            // dragEnd / drop clears it. No onDragLeave — clearing on
                            // every child boundary crossing makes the marker flicker.
                            if (dragOverItemId !== row.item.id) setDragOverItemId(row.item.id);
                            if (dragOverColumnId !== column.id) setDragOverColumnId(column.id);
                          }}
                          onDrop={(event) => {
                            if (!sourceId || !canDrop) return;
                            event.preventDefault();
                            event.stopPropagation();
                            void applyMove(sourceId, row.item.id);
                          }}
                        >
                          <div className="px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onMouseEnter={() => {
                                  if (!editItemId && !rescheduleItemId) {
                                    selectItem(row.item.id, { fromListNavigation: true });
                                  }
                                }}
                                onClick={() => selectItem(row.item.id, { fromListNavigation: true })}
                                className={`min-w-0 truncate text-left text-[11px] leading-5 ${isPastDue ? "font-semibold text-red-800" : "text-black/58"}`}
                              >
                                {dueLabelForList(row.item.dueAt)}
                              </button>

                              <div className={`flex shrink-0 items-center justify-end gap-1 transition-opacity ${actionsDimmed ? "pointer-events-none opacity-30" : ""}`} aria-hidden={actionsDimmed || undefined}>
                                <button
                                  type="button"
                                  disabled={actionsDimmed}
                                  onClick={() => void toggleStar(row.item.id)}
                                  aria-pressed={Boolean(row.item.isStarred)}
                                  className={`inline-flex h-8 w-8 items-center justify-center border transition disabled:cursor-not-allowed ${
                                    row.item.isStarred
                                      ? "border-[#c8941f]/55 hover:border-[#c8941f]"
                                      : "border-black/18 text-black/35 hover:border-black hover:text-black"
                                  }`}
                                  aria-label={row.item.isStarred ? "Unstar task" : "Star task"}
                                  title={row.item.isStarred ? "Unstar (⇧⌘1)" : "Star (⇧⌘1)"}
                                >
                                  <Star
                                    className="h-4 w-4"
                                    strokeWidth={1.6}
                                    fill={row.item.isStarred ? STAR_GOLD : "none"}
                                    color={row.item.isStarred ? STAR_GOLD : "currentColor"}
                                  />
                                </button>
                                <button
                                  type="button"
                                  ref={(el) => {
                                    if (el) doneButtonRefs.current.set(row.item.id, el);
                                    else doneButtonRefs.current.delete(row.item.id);
                                  }}
                                  disabled={actionsDimmed || isLeavingRow}
                                  onClick={() => void markDone(row.item.id)}
                                  className="inline-flex h-8 w-8 items-center justify-center border border-black/22 text-[12px] font-semibold text-black/60 transition hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed"
                                  aria-label="Mark task as done"
                                  title="Mark task as done (⇧⌘D)"
                                >
                                  <span aria-hidden="true">✓</span>
                                </button>
                                <button
                                  type="button"
                                  ref={(el) => {
                                    if (el) deleteButtonRefs.current.set(row.item.id, el);
                                    else deleteButtonRefs.current.delete(row.item.id);
                                  }}
                                  disabled={actionsDimmed || isLeavingRow}
                                  onClick={() => void removeItem(row.item.id)}
                                  className="inline-flex h-8 w-8 items-center justify-center border border-black/18 text-black/45 hover:border-black hover:text-black disabled:cursor-not-allowed"
                                  aria-label="Delete task"
                                  title="Delete (⇧⌘⌫)"
                                >
                                  🗑
                                </button>
                                <button
                                  type="button"
                                  disabled={actionsDimmed}
                                  onClick={() => setMenuItemId((current) => (current === row.item.id ? null : row.item.id))}
                                  className="hidden h-8 w-8 items-center justify-center border border-black/18 text-black/45 hover:border-black hover:text-black disabled:cursor-not-allowed sm:inline-flex"
                                  aria-label="More actions"
                                >
                                  …
                                </button>
                              </div>
                            </div>

                            {isEditingRow ? (
                              <div className="mt-1 flex w-full items-start gap-2">
                                {row.depth > 0 ? (
                                  <span className="mt-[5px] text-[10px] text-black/38" style={{ marginLeft: `${Math.min(row.depth, 4) * 10}px` }}>↳</span>
                                ) : null}
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
                                  ) : null}
                                  <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:hidden">
                                    <button
                                      type="button"
                                      onClick={() => void submitRename(row.item.id)}
                                      className="min-h-8 border border-black bg-black px-3 text-[11px] uppercase tracking-[0.14em] text-white outline-none sm:hidden"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                draggable
                                onMouseEnter={() => {
                                  if (!editItemId && !rescheduleItemId) {
                                    selectItem(row.item.id, { fromListNavigation: true });
                                  }
                                }}
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", row.item.id);
                                  setMenuItemId(null);
                                  setGrabbedItemId(null);
                                  setDraggedItemId(row.item.id);
                                }}
                                onDragEnd={() => {
                                  setDraggedItemId(null);
                                  setDragOverItemId(null);
                                  setDragOverColumnId(null);
                                }}
                                onClick={() => {
                                  selectItem(row.item.id, { fromListNavigation: true });
                                  void commitInlineEditIfNeeded();
                                  flushSync(() => beginItemEdit(row.item));
                                  const input = editInputRef.current;
                                  if (input) {
                                    input.focus();
                                    const end = input.value.length;
                                    input.setSelectionRange(end, end);
                                  }
                                }}
                                className="mt-1 flex w-full cursor-grab items-start gap-2 text-left active:cursor-grabbing"
                              >
                                {row.depth > 0 ? (
                                  <span className="mt-[5px] text-[10px] text-black/38" style={{ marginLeft: `${Math.min(row.depth, 4) * 10}px` }}>↳</span>
                                ) : null}
                                <span className="min-w-0 flex-1">
                                  <span className="hero-title-text block break-words text-[15px] leading-6 text-black">{row.item.title}</span>
                                </span>
                                {isLeavingRow ? (
                                  <span className="relative ml-2 mt-1 inline-flex h-6 w-6 items-center justify-center">
                                    {leavingKind === "delete" ? (
                                      <>
                                        <span className="hero-delete-burst absolute inset-0 rounded-full" />
                                        <span className="hero-delete-x-mark relative inline-flex h-6 w-6 items-center justify-center rounded-full text-white text-sm font-bold shadow-[0_6px_18px_rgba(220,38,38,0.35)]">
                                          ✕
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="hero-done-burst absolute inset-0 rounded-full bg-emerald-400/60" />
                                        <span className="hero-done-check-mark relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold shadow-[0_6px_18px_rgba(5,150,105,0.35)]">
                                          ✓
                                        </span>
                                      </>
                                    )}
                                  </span>
                                ) : null}
                              </button>
                            )}

                            {menuItemId === row.item.id ? (
                              <div className="mt-2 border-l border-black/15 pl-4 text-xs text-black/72">
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
                                  <button
                                    type="button"
                                    onClick={() => setGrabbedItemId((current) => (current === row.item.id ? null : row.item.id))}
                                    className="border border-black px-2 py-1"
                                  >
                                    {grabbedItemId === row.item.id ? "Cancel move" : "Move"}
                                  </button>
                                  <button type="button" onClick={() => setActiveItemId(row.item.id)} className="border border-black px-2 py-1">
                                    Focus
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            {grabbedItemId && grabbedItemId !== row.item.id && !draggedItemId ? (
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-black/48">
                                <button
                                  type="button"
                                  onClick={() => void applyMove(grabbedItemId, row.item.id)}
                                  className="border border-dashed border-black px-2 py-1 hover:border-solid hover:bg-black hover:text-white"
                                >
                                  Drop after this
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}

                    {rows.length === 0 ? (
                      <div className="px-3 py-8 text-center text-[12px] leading-6 text-black/45">
                        {sourceId ? "Drop here to move it into this project." : emptyColumnText}
                      </div>
                    ) : null}

                    {grabbedItemId && !draggedItemId && columnIdByItemId.get(grabbedItemId) !== column.id ? (
                      <div className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void applyMoveToColumn(grabbedItemId, column.id)}
                          className="w-full border border-dashed border-black px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-black/60 hover:border-solid hover:bg-black hover:text-white"
                        >
                          Move into {column.name}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>

          {/* Trophy shelf: starred tasks finished today linger here as a vanity
              reward, even though done tasks otherwise vanish from Today. Today
              view only, read-only — no actions, these are won, not pending. */}
          {listMode === "today" && hero.starredDoneTodayItems.length > 0 ? (
            <section className="border-t border-[#c8941f]/30 bg-[#c8941f]/[0.04] px-3 py-4 sm:px-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9a7016]">
                <Trophy className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span>
                  Today’s trophies · {hero.starredDoneTodayItems.length}
                </span>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {hero.starredDoneTodayItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <Star className="h-4 w-4 shrink-0" strokeWidth={1.6} fill={STAR_GOLD} color={STAR_GOLD} />
                    <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-black/70">{item.title}</span>
                    {item.completedAt ? (
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-[#9a7016]/75">
                        {dueLabelForList(item.completedAt)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className={`hidden border-t border-black px-3 py-3 sm:block sm:px-4 ${activeItemId ? "hero-tunnel-dim" : ""}`}>
            <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-black">
              {activeItemId
                ? "Task active"
                : grabbedItemId || draggedItemId
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
              {activeItemId
                ? "Everything else is dimmed · Press Escape to exit."
                : grabbedItemId || draggedItemId
                  ? "Drop after a task to slot below it, or onto a project's empty space to move it there."
                  : rescheduleItemId
                    ? "Type a new wake-up time · Enter saves · Escape cancels."
                    : editItemId
                      ? "Enter saves · Escape exits edit · ↑ / ↓ move to the next task · ⇧⌘D to mark done · ⇧⌘⌫ to delete · ⇧⌘A to activate task."
                      : captureFocused
                        ? "Enter saves · no time means it wakes up in 5 minutes · Escape clears focus · ↓ jumps into this project's list."
                        : "Press T for a new task · ↑ / ↓ edit as you browse · drag tasks between projects · ⇧⌘A to activate the hovered task · ? for help."}
            </div>
          </footer>
        </section>
      </div>
      {confettiBursts.length
        ? createPortal(
            <div className="hero-confetti-layer" aria-hidden="true">
              {confettiBursts.map((burst) => (
                <span
                  key={burst.id}
                  className={burst.kind === "delete" ? "hero-delete-confetti" : "hero-done-confetti"}
                  style={{ left: `${burst.x}px`, top: `${burst.y}px` }}
                >
                  <span /><span /><span /><span /><span /><span /><span /><span />
                </span>
              ))}
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
