/*
Design note for this file:
- Re-center Hero on the original extension ritual: one line in, one calm list out.
- Keep the surface sparse and monochrome; secondary actions should stay hidden until asked for.
- Today is the default home, while All and Analytics stay lightweight and adjacent rather than competing for attention.
*/
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  formatDueLabel,
  parseCaptureInput,
  previewCaptureInput,
  useHeroApp,
  type HeroItem,
} from "@/hooks/useHeroApp";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";

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
        <div className="flex items-center justify-between gap-3"><span>save from the input</span><span className="font-semibold">Enter</span></div>
        <div className="flex items-center justify-between gap-3"><span>move focus</span><span className="font-semibold">J / K</span></div>
        <div className="flex items-center justify-between gap-3"><span>pick up selected task</span><span className="font-semibold">Space</span></div>
        <div className="flex items-center justify-between gap-3"><span>drop under selected task</span><span className="font-semibold">Enter</span></div>
        <div className="flex items-center justify-between gap-3"><span>drop after selected task</span><span className="font-semibold">Shift + Enter</span></div>
        <div className="flex items-center justify-between gap-3"><span>mark selected done</span><span className="font-semibold">D</span></div>
        <div className="flex items-center justify-between gap-3"><span>delete selected task</span><span className="font-semibold">Delete</span></div>
        <div className="flex items-center justify-between gap-3"><span>toggle this panel</span><span className="font-semibold">?</span></div>
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
        <div className="flex items-center gap-2 border-b border-black pb-3 text-sm font-semibold">
          <img src={heroMark} alt="Hero" className="h-5 w-5" />
          <span>Hero</span>
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
  const [showHelp, setShowHelp] = useState(false);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [rescheduleItemId, setRescheduleItemId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("tomorrow 9am");
  const [grabbedItemId, setGrabbedItemId] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  const filteredItems = useMemo(
    () => (listMode === "today" ? hero.upcomingItems.filter((item) => isDueTodayOrOverdue(item.dueAt)) : hero.upcomingItems),
    [hero.upcomingItems, listMode],
  );

  const displayRows = useMemo(() => buildDisplayRows(filteredItems), [filteredItems]);
  const projectMap = useMemo(() => new Map(hero.projects.map((project) => [project.id, project.name])), [hero.projects]);
  const selectedIndex = useMemo(() => displayRows.findIndex((row) => row.item.id === hero.selectedId), [displayRows, hero.selectedId]);
  const selectedRow = selectedIndex >= 0 ? displayRows[selectedIndex] : displayRows[0] ?? null;
  const capturePreview = useMemo(() => previewCaptureInput(captureInput), [captureInput]);
  const parsedCapture = useMemo(() => parseCaptureInput(captureInput), [captureInput]);

  useEffect(() => {
    if (!displayRows.length) {
      if (hero.selectedId) hero.setSelectedId(null);
      return;
    }

    if (!hero.selectedId || !displayRows.some((row) => row.item.id === hero.selectedId)) {
      hero.setSelectedId(displayRows[0].item.id);
    }
  }, [displayRows, hero, hero.selectedId]);

  async function submitCapture(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const result = await hero.saveDraft({
      title: "",
      dueInput: "",
      captureInput,
      type: "task",
    });

    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    setCaptureInput("");
  }

  async function markDone(itemId: string) {
    const result = await hero.markDone(itemId);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
  }

  async function removeItem(itemId: string) {
    const result = await hero.removeItem(itemId);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
  }

  async function applyMove(itemId: string, targetId: string, mode: MoveMode) {
    const result = await hero.moveItem(itemId, targetId, mode);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    setGrabbedItemId(null);
    setDraggedItemId(null);
  }

  async function submitRename(itemId: string) {
    const result = await hero.renameItem(itemId, editValue);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    setEditItemId(null);
    setMenuItemId(null);
  }

  async function submitReschedule(itemId: string) {
    const result = await hero.rescheduleItem(itemId, rescheduleValue);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    setRescheduleItemId(null);
    setMenuItemId(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!hero.user) return;
      if (isEditingField(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        setShowHelp((current) => !current);
        return;
      }

      if (!displayRows.length || !selectedRow) return;

      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        const next = displayRows[Math.min(selectedIndex + 1, displayRows.length - 1)] ?? selectedRow;
        hero.setSelectedId(next.item.id);
        return;
      }

      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        const next = displayRows[Math.max(selectedIndex - 1, 0)] ?? selectedRow;
        hero.setSelectedId(next.item.id);
        return;
      }

      if ((event.key === " " || event.code === "Space") && listMode === "today") {
        event.preventDefault();
        setGrabbedItemId((current) => (current === selectedRow.item.id ? null : selectedRow.item.id));
        setMenuItemId(null);
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

      if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        void markDone(selectedRow.item.id);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void removeItem(selectedRow.item.id);
        return;
      }

      if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        setMenuItemId(selectedRow.item.id);
        setEditItemId(selectedRow.item.id);
        setEditValue(selectedRow.item.title);
        return;
      }

      if (event.key === "z" || event.key === "Z" || event.key === "u" || event.key === "U") {
        event.preventDefault();
        void hero.undoLastAction().then((result) => {
          if (!result.ok) return toast.error(result.message);
          toast.success(result.message);
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayRows, grabbedItemId, hero, listMode, navigate, selectedIndex, selectedRow]);

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
              <div className="flex items-center gap-2 text-sm font-semibold">
                <img src={heroMark} alt="Hero" className="h-5 w-5" />
                <span>Hero</span>
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
                  onClick={() => setShowHelp((current) => !current)}
                  className="inline-flex h-7 w-7 items-center justify-center border border-black text-[13px] font-semibold text-black"
                  aria-label="Show help"
                >
                  ?
                </button>
              </nav>

              {showHelp ? <HelpPanel onClose={() => setShowHelp(false)} onSignOut={() => void hero.signOut()} /> : null}
            </div>

            <form onSubmit={submitCapture} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={captureInput}
                onChange={(event) => setCaptureInput(event.target.value)}
                placeholder="follow up with Katherine tomorrow 9am"
                className="min-h-11 w-full border border-black bg-white px-3 text-[15px] outline-none"
              />
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
              const isSelected = hero.selectedId === row.item.id;
              const projectName = row.item.projectId ? projectMap.get(row.item.projectId) ?? null : null;
              const canDrop = Boolean((draggedItemId || grabbedItemId) && row.item.id !== draggedItemId && row.item.id !== grabbedItemId);
              const sourceId = draggedItemId || grabbedItemId;

              return (
                <article key={row.item.id} className={isSelected ? "bg-black/[0.035]" : "bg-white"}>
                  <div className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:px-4">
                    <button
                      type="button"
                      onClick={() => hero.setSelectedId(row.item.id)}
                      className="pt-1 text-left text-[11px] leading-5 text-black/58 sm:text-xs"
                    >
                      {dueLabelForList(row.item.dueAt)}
                    </button>

                    <div className="min-w-0">
                      <button
                        type="button"
                        draggable={listMode === "today"}
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
                        onClick={() => hero.setSelectedId(row.item.id)}
                        onDoubleClick={() => navigate(`/due/${row.item.id}`)}
                        className="flex w-full items-start gap-3 text-left"
                      >
                        <span className="mt-[5px] text-[10px] text-black/38">{row.depth > 0 ? "↳" : "□"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-[15px] leading-6 text-black">{row.item.title}</span>
                          {projectName ? <span className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-black/45">{projectName}</span> : null}
                        </span>
                      </button>

                      {menuItemId === row.item.id ? (
                        <div className="mt-2 border-l border-black/15 pl-6 text-xs text-black/72">
                          {editItemId === row.item.id ? (
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                value={editValue}
                                onChange={(event) => setEditValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void submitRename(row.item.id);
                                  }
                                  if (event.key === "Escape") {
                                    setEditItemId(null);
                                  }
                                }}
                                className="min-h-10 flex-1 border border-black px-3 text-sm outline-none"
                              />
                              <button type="button" onClick={() => void submitRename(row.item.id)} className="min-h-10 border border-black px-3">
                                Save
                              </button>
                            </div>
                          ) : null}

                          {rescheduleItemId === row.item.id ? (
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                              <input
                                value={rescheduleValue}
                                onChange={(event) => setRescheduleValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void submitReschedule(row.item.id);
                                  }
                                  if (event.key === "Escape") {
                                    setRescheduleItemId(null);
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
                              onClick={() => {
                                setEditItemId(row.item.id);
                                setEditValue(row.item.title);
                                setRescheduleItemId(null);
                              }}
                              className="border border-black px-2 py-1"
                            >
                              Rename
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

                    <div className="flex items-center gap-1 pl-1">
                      <button
                        type="button"
                        onClick={() => void markDone(row.item.id)}
                        className="inline-flex h-9 w-9 items-center justify-center border border-black/18 text-black/56 hover:border-black hover:text-black"
                        aria-label="Mark done"
                      >
                        ◯
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeItem(row.item.id)}
                        className="inline-flex h-9 w-9 items-center justify-center border border-black/18 text-black/45 hover:border-black hover:text-black"
                        aria-label="Delete task"
                      >
                        🗑
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuItemId((current) => (current === row.item.id ? null : row.item.id))}
                        className="inline-flex h-9 w-9 items-center justify-center border border-black/18 text-black/45 hover:border-black hover:text-black"
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

          <footer className="border-t border-black px-3 py-3 text-[11px] uppercase tracking-[0.14em] text-black/48 sm:px-4">
            {grabbedItemId
              ? "Move mode is active. Drop under a task to create a chain, or drop after to reorder it."
              : "Shortcuts stay hidden until you click ? or type ?. Double-click a task to open the focus view."}
          </footer>
        </section>
      </div>
    </main>
  );
}
