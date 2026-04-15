/*
Design note for this file:
- Preserve the original Hero extension feel: spare monochrome framing, compact language, and a Today-first list.
- Mobile usability matters as much as desktop usability, so the same screen must work for touch-first phones and keyboard-first browsers.
- The list remains the product, but phone users now get touch-sized controls, stacked detail blocks, and explicit open actions instead of relying on hidden shortcuts.
*/
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  formatDueLabel,
  formatPreviewFromInput,
  legacyShortcutHints,
  useHeroApp,
} from "@/hooks/useHeroApp";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";

function isEditingField(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(element?.isContentEditable);
}

function isTodayOrOverdue(value: string) {
  const due = new Date(value);
  const now = new Date();
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  return sameDay || due.getTime() <= now.getTime();
}

function ShortcutRail({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={mobile ? "text-xs" : "border border-black bg-[#e4e6ea] p-3 text-xs"}>
      <table className="w-full">
        <tbody>
          <tr>
            <td colSpan={2} className="pb-2 font-semibold">
              Navigation
            </td>
          </tr>
          {legacyShortcutHints.slice(0, 2).map((hint) => (
            <tr key={hint.key}>
              <td className="py-1 text-black/75">{hint.description}</td>
              <td className="py-1 text-right font-semibold">{hint.key}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1 text-black/75">View done</td>
            <td className="py-1 text-right font-semibold">Tab</td>
          </tr>
          <tr>
            <td className="py-1 text-black/75">Open due/link</td>
            <td className="py-1 text-right font-semibold">Enter</td>
          </tr>
          <tr>
            <td colSpan={2} className="pt-3 pb-2 font-semibold">
              Actions
            </td>
          </tr>
          {legacyShortcutHints.slice(2).map((hint) => (
            <tr key={hint.key}>
              <td className="py-1 text-black/75">{hint.description}</td>
              <td className="py-1 text-right font-semibold">{hint.key}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1 text-black/75">Open quick add</td>
            <td className="py-1 text-right font-semibold">N</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();

  const titleInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const dueInputRef = useRef<HTMLInputElement>(null);
  const composerDueInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const projectSelectRef = useRef<HTMLSelectElement>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDueInput, setDraftDueInput] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftType, setDraftType] = useState<"task" | "link">("task");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftRecurring, setDraftRecurring] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState<"signin" | "signup" | null>(null);

  const hostedAuthEnabled = Boolean(import.meta.env.VITE_SUPABASE_URL);

  const projectMap = useMemo(
    () => new Map(hero.projects.map((project) => [project.id, project.name])),
    [hero.projects],
  );

  const activeItems = useMemo(() => {
    if (hero.activeProjectId === "all") return hero.upcomingItems;
    return hero.upcomingItems.filter((item) => item.projectId === hero.activeProjectId);
  }, [hero.activeProjectId, hero.upcomingItems]);

  const todayItems = useMemo(() => activeItems.filter((item) => isTodayOrOverdue(item.dueAt)), [activeItems]);
  const laterItems = useMemo(() => activeItems.filter((item) => !isTodayOrOverdue(item.dueAt)), [activeItems]);
  const visibleItems = todayItems.length ? [...todayItems, ...laterItems.slice(0, 8)] : activeItems;
  const reminderPreview = formatPreviewFromInput(draftDueInput);

  useEffect(() => {
    setRenameValue(hero.selectedItem?.title ?? "");
    setRescheduleValue("");
  }, [hero.selectedItem]);

  function openComposer() {
    setDraftProjectId((current) => {
      if (current) return current;
      return hero.activeProjectId !== "all" ? hero.activeProjectId : "";
    });
    hero.setComposerOpen(true);
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  }

  function closeComposer() {
    hero.setComposerOpen(false);
  }

  function openItem(item: (typeof hero.items)[number]) {
    if (item.type === "link" && item.url) {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }

    if (isTodayOrOverdue(item.dueAt)) {
      navigate(`/due/${item.id}`);
    }
  }

  function handleComposerFieldKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    field: "title" | "due" | "url" | "project",
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer();
      return;
    }

    if (field === "title" && event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      void handleSaveDraft();
      return;
    }

    if (field === "title" && event.key === "Enter") {
      event.preventDefault();
      composerDueInputRef.current?.focus();
      return;
    }

    if ((field === "due" || field === "url" || field === "project") && event.key === "Enter") {
      event.preventDefault();
      void handleSaveDraft();
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isField = isEditingField(event.target);

      if (event.key === "Escape" && hero.composerOpen) {
        event.preventDefault();
        closeComposer();
        return;
      }

      if ((event.key === "n" || event.key === "N") && !isField) {
        event.preventDefault();
        openComposer();
        return;
      }

      if (event.key === "Tab" && !isField) {
        event.preventDefault();
        navigate("/done");
        return;
      }

      if ((event.key === "ArrowDown" || event.key === "j" || event.key === "J") && !isField) {
        event.preventDefault();
        const index = Math.max(0, hero.upcomingItems.findIndex((item) => item.id === hero.selectedId));
        const next = hero.upcomingItems[index + 1] ?? hero.upcomingItems[index] ?? hero.upcomingItems[0];
        if (next) hero.setSelectedId(next.id);
        return;
      }

      if ((event.key === "ArrowUp" || event.key === "k" || event.key === "K") && !isField) {
        event.preventDefault();
        const index = Math.max(0, hero.upcomingItems.findIndex((item) => item.id === hero.selectedId));
        const next = hero.upcomingItems[index - 1] ?? hero.upcomingItems[0];
        if (next) hero.setSelectedId(next.id);
        return;
      }

      if ((event.key === "d" || event.key === "D") && !isField && hero.selectedItem) {
        event.preventDefault();
        void hero.markDone(hero.selectedItem.id).then((result) => {
          if (!result.ok) return toast.error(result.message);
          toast.success(result.message);
        });
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && !isField && hero.selectedItem) {
        event.preventDefault();
        void hero.removeItem(hero.selectedItem.id).then((result) => {
          if (!result.ok) return toast.error(result.message);
          toast.success(result.message);
        });
        return;
      }

      if ((event.key === "z" || event.key === "Z") && !isField) {
        event.preventDefault();
        void hero.undoLastAction().then((result) => {
          if (!result.ok) return toast.error(result.message);
          toast.success(result.message);
        });
        return;
      }

      if ((event.key === "e" || event.key === "E") && !isField && hero.selectedItem) {
        event.preventDefault();
        window.requestAnimationFrame(() => dueInputRef.current?.focus());
        return;
      }

      if ((event.key === "Enter" || event.key === "o" || event.key === "O") && !isField && hero.selectedItem) {
        event.preventDefault();
        openItem(hero.selectedItem);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hero, navigate]);

  async function handleSaveDraft() {
    const result = await hero.saveDraft({
      title: draftTitle,
      dueInput: draftDueInput,
      projectId: draftProjectId || undefined,
      type: draftType,
      url: draftType === "link" ? draftUrl : undefined,
      isRecurringDaily: draftRecurring,
    });

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    setDraftTitle("");
    setDraftDueInput("");
    setDraftProjectId("");
    setDraftType("task");
    setDraftUrl("");
    setDraftRecurring(false);
    hero.setComposerOpen(false);
  }

  async function handleRename() {
    if (!hero.selectedItem) return;
    const result = await hero.renameItem(hero.selectedItem.id, renameValue);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
  }

  async function handleReschedule() {
    if (!hero.selectedItem) return;
    const result = await hero.rescheduleItem(hero.selectedItem.id, rescheduleValue);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    setRescheduleValue("");
  }

  async function handleAddProject() {
    const result = await hero.addProject(newProjectName);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    setNewProjectName("");
  }

  async function handleSignIn() {
    setAuthBusy("signin");
    const result = hostedAuthEnabled
      ? await hero.signInWithPassword(authEmail, authPassword)
      : await hero.signIn();
    setAuthBusy(null);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
  }

  async function handleCreateAccount() {
    setAuthBusy("signup");
    const result = hostedAuthEnabled
      ? await hero.signUpWithPassword(authEmail, authPassword)
      : await hero.signIn();
    setAuthBusy(null);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
  }

  async function handleSignOut() {
    await hero.signOut();
    toast.success("Signed out.");
  }

  if (!hero.authChecked) {
    return (
      <main className="min-h-screen bg-[#eef0f3] px-3 py-5 text-black sm:px-4 sm:py-8">
        <div className="mx-auto max-w-md border border-black bg-white px-4 py-4 text-sm sm:px-5">
          <div className="flex items-center gap-2">
            <img src={heroMark} alt="Hero" className="h-5 w-5" />
            <span className="text-lg font-semibold">Hero</span>
          </div>
          <p className="mt-4 text-sm text-black/70">Checking workspace…</p>
        </div>
      </main>
    );
  }

  if (!hero.user) {
    return (
      <main className="min-h-screen bg-[#eef0f3] px-3 py-5 text-black sm:px-4 sm:py-8">
        <div className="mx-auto max-w-md border border-black bg-white px-4 py-4 sm:px-5">
          <div className="flex items-center gap-2 border-b border-black pb-3">
            <img src={heroMark} alt="Hero" className="h-5 w-5" />
            <span className="text-lg font-semibold">Hero</span>
          </div>

          <p className="mt-4 text-sm leading-6 text-black/75">
            A fast, opinionated task list built around shortcuts, now tuned to stay usable on both phones and browsers.
          </p>

          {hostedAuthEnabled ? (
            <div className="mt-4 space-y-3 text-sm">
              <input
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                type="email"
                autoComplete="email"
                placeholder="email"
                className="w-full border border-black bg-white px-3 py-3 outline-none"
              />
              <input
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="password"
                className="w-full border border-black bg-white px-3 py-3 outline-none"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void handleSignIn()}
                  disabled={authBusy !== null}
                  className="border border-black bg-black px-3 py-3 text-white disabled:opacity-50"
                >
                  {authBusy === "signin" ? "Signing in..." : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateAccount()}
                  disabled={authBusy !== null}
                  className="border border-black bg-white px-3 py-3 text-black disabled:opacity-50"
                >
                  {authBusy === "signup" ? "Creating..." : "Create account"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void handleSignIn()}
                className="w-full border border-black bg-black px-3 py-3 text-white sm:w-auto"
              >
                Open demo workspace
              </button>
            </div>
          )}

          <div className="mt-5 border-t border-black pt-3 text-xs leading-6 text-black/70">
            <p>{hero.statusMessage}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#eef0f3] text-black">
      <header className="sticky top-0 z-20 border-b border-black bg-white px-3 sm:px-4">
        <div className="mx-auto flex min-h-[52px] max-w-[1120px] items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <img src={heroMark} alt="Hero" className="h-5 w-5" />
            <span className="font-semibold">Hero</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={openComposer}
              className="border border-black bg-black px-3 py-2 text-white"
            >
              New
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="border border-black bg-white px-3 py-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1120px] gap-3 px-3 py-3 xl:grid-cols-[minmax(0,1fr)_220px] sm:px-4 sm:py-4">
        <section className="min-w-0 border border-black bg-white">
          <div className="border-b border-black px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="font-semibold">{hero.user.mode === "demo" ? "Demo" : hero.user.email}</div>
              <div className="flex items-center gap-3 text-black/70">
                <span>{todayItems.length} today</span>
                <span>{hero.doneTodayCount} done</span>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none">Today</div>
                <div className="mt-1 max-w-2xl text-xs leading-5 text-black/70">{hero.statusMessage}</div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="border-b border-black pb-[2px] font-semibold">Upcoming</span>
                <Link href="/done" className="text-black/70 hover:text-black">
                  Done
                </Link>
              </div>
            </div>
          </div>

          {hero.composerOpen ? (
            <form
              className="border-b border-black bg-black px-4 py-4 text-white"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveDraft();
              }}
            >
              <div className="mx-auto max-w-[520px]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="text-[13px] leading-5 text-white/70">
                    <div className="font-semibold text-white/85">Quick add</div>
                    <div className="text-[11px]">Enter moves to wake-up time. Shift+Enter also saves.</div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setDraftType("task")}
                      className={`border px-3 py-2 ${draftType === "task" ? "border-white bg-white text-black" : "border-white/50 bg-black text-white"}`}
                    >
                      Task
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftType("link")}
                      className={`border px-3 py-2 ${draftType === "link" ? "border-white bg-white text-black" : "border-white/50 bg-black text-white"}`}
                    >
                      Link
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">Task</label>
                    <input
                      ref={titleInputRef}
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => handleComposerFieldKeyDown(event, "title")}
                      placeholder="Example: Cancel spotify subscription"
                      className="mt-2 w-full border border-white/50 bg-black px-3 py-3 text-sm outline-none placeholder:text-white/45"
                    />
                  </div>

                  <div>
                    <label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">Wake up time</label>
                    <input
                      ref={composerDueInputRef}
                      value={draftDueInput}
                      onChange={(event) => setDraftDueInput(event.target.value)}
                      onKeyDown={(event) => handleComposerFieldKeyDown(event, "due")}
                      placeholder="Try: 8 am, in 2 hours, aug 7, today 12:30pm"
                      className="mt-2 w-full border border-white/50 bg-black px-3 py-3 text-sm outline-none placeholder:text-white/45"
                    />
                    <div className="mt-2 min-h-10 w-full border border-white/15 bg-[#363636] px-3 py-2 text-[12px] leading-5 text-white">
                      {reminderPreview}
                    </div>
                  </div>

                  {draftType === "link" ? (
                    <div>
                      <label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">Link URL</label>
                      <input
                        ref={urlInputRef}
                        value={draftUrl}
                        onChange={(event) => setDraftUrl(event.target.value)}
                        onKeyDown={(event) => handleComposerFieldKeyDown(event, "url")}
                        placeholder="https://..."
                        className="mt-2 w-full border border-white/50 bg-black px-3 py-3 text-sm outline-none placeholder:text-white/45"
                      />
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <div>
                      <label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">Project</label>
                      <select
                        ref={projectSelectRef}
                        value={draftProjectId}
                        onChange={(event) => setDraftProjectId(event.target.value)}
                        onKeyDown={(event) => handleComposerFieldKeyDown(event, "project")}
                        className="mt-2 w-full border border-white/50 bg-black px-3 py-3 text-[12px] text-white outline-none"
                      >
                        <option value="">No project</option>
                        {hero.projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-center gap-3 self-end border border-white/20 px-3 py-3 text-[12px] text-white/80">
                      <input
                        checked={draftRecurring}
                        onChange={(event) => setDraftRecurring(event.target.checked)}
                        type="checkbox"
                        className="h-4 w-4 accent-white"
                      />
                      Repeat every day
                    </label>
                  </div>

                  <div className="flex flex-col gap-2 text-[11px] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      Press <kbd className="border border-white/50 bg-[#5a5a5a] px-1.5 py-[1px] font-mono text-[10px] text-white">enter</kbd> to keep moving, then save.
                    </div>
                    <div className="grid gap-2 sm:flex">
                      <button type="button" onClick={closeComposer} className="border border-white/50 bg-black px-3 py-2 text-white">
                        Cancel
                      </button>
                      <button type="submit" className="border border-white bg-white px-3 py-2 font-semibold text-black">
                        Save task
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          ) : null}

          <div className="border-b border-black/15 px-4 py-2 text-[11px] text-black/65">
            Tap a row to reveal edit controls. Keyboard shortcuts still work on desktop.
          </div>

          <div className="divide-y divide-black/15">
            {visibleItems.map((item) => {
              const selected = hero.selectedId === item.id;
              const isDue = isTodayOrOverdue(item.dueAt);
              const projectName = item.projectId ? projectMap.get(item.projectId) ?? "—" : "—";

              return (
                <article
                  key={item.id}
                  onClick={() => hero.setSelectedId(item.id)}
                  className={`${selected ? "bg-[#eceef2]" : "bg-white hover:bg-[#f5f6f8]"} cursor-pointer px-4 py-3 transition-colors`}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-black/65">
                          <span>{formatDueLabel(item.dueAt)}</span>
                          {projectName !== "—" ? <span>{projectName}</span> : null}
                          {item.type === "link" ? <span>link</span> : null}
                          {item.isRecurringDaily ? <span>daily</span> : null}
                          {isDue ? <span className="font-semibold text-black">today</span> : null}
                        </div>
                        <div className="mt-1 flex items-start gap-2">
                          <span className="mt-[6px] inline-block h-2.5 w-2.5 shrink-0 border border-black bg-white" />
                          <div className="min-w-0">
                            <div className="break-words text-sm leading-5 text-black sm:text-[15px]">{item.title}</div>
                          </div>
                        </div>
                      </div>

                      <div className="hidden shrink-0 gap-1 sm:flex">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openItem(item);
                          }}
                          className="border border-black bg-white px-2 py-1 text-[11px]"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void hero.markDone(item.id).then((result) => {
                              if (!result.ok) return toast.error(result.message);
                              toast.success(result.message);
                            });
                          }}
                          className="border border-black bg-white px-2 py-1 text-[11px]"
                        >
                          D
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void hero.removeItem(item.id).then((result) => {
                              if (!result.ok) return toast.error(result.message);
                              toast.success(result.message);
                            });
                          }}
                          className="border border-black bg-white px-2 py-1 text-[11px]"
                        >
                          X
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2 sm:hidden">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openItem(item);
                        }}
                        className="min-h-10 flex-1 border border-black bg-white px-3 py-2 text-sm"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void hero.markDone(item.id).then((result) => {
                            if (!result.ok) return toast.error(result.message);
                            toast.success(result.message);
                          });
                        }}
                        className="min-h-10 border border-black bg-white px-3 py-2 text-sm"
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void hero.removeItem(item.id).then((result) => {
                            if (!result.ok) return toast.error(result.message);
                            toast.success(result.message);
                          });
                        }}
                        className="min-h-10 border border-black bg-white px-3 py-2 text-sm"
                      >
                        Delete
                      </button>
                    </div>

                    {selected ? (
                      <div className="grid gap-2 border-t border-black/15 pt-3 sm:grid-cols-[minmax(0,1fr)_180px_auto_auto] sm:items-center">
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleRename();
                            }
                          }}
                          className="min-h-10 border border-black bg-white px-3 py-2 outline-none"
                        />
                        <input
                          ref={dueInputRef}
                          value={rescheduleValue}
                          onChange={(event) => setRescheduleValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleReschedule();
                            }
                          }}
                          placeholder="today 6pm"
                          className="min-h-10 border border-black bg-white px-3 py-2 outline-none"
                        />
                        <button type="button" onClick={() => void handleRename()} className="min-h-10 border border-black bg-white px-3 py-2">
                          Rename
                        </button>
                        <button type="button" onClick={() => void handleReschedule()} className="min-h-10 border border-black bg-white px-3 py-2">
                          Edit time
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {visibleItems.length === 0 ? (
              <div className="px-4 py-10 text-sm leading-6 text-black/65">
                No items here yet. Press <span className="border border-black px-1">N</span> on desktop or tap <span className="font-semibold text-black">New</span> on your phone.
              </div>
            ) : null}
          </div>

          <div className="border-t border-black px-4 py-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
              <div className="min-w-0">
                <div className="overflow-x-auto pb-1">
                  <div className="flex min-w-max items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => hero.setActiveProjectId("all")}
                      className={`min-h-9 border px-3 py-2 ${hero.activeProjectId === "all" ? "border-black bg-black text-white" : "border-black bg-white text-black"}`}
                    >
                      All
                    </button>
                    {hero.projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => hero.setActiveProjectId(project.id)}
                        className={`min-h-9 border px-3 py-2 ${hero.activeProjectId === project.id ? "border-black bg-black text-white" : "border-black bg-white text-black"}`}
                      >
                        {project.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleAddProject();
                    }
                  }}
                  placeholder="new project"
                  className="min-h-10 min-w-0 border border-black bg-white px-3 py-2 outline-none"
                />
                <button type="button" onClick={() => void handleAddProject()} className="min-h-10 border border-black bg-white px-4 py-2">
                  Add
                </button>
              </div>
            </div>
          </div>

          <details className="border-t border-black bg-[#e4e6ea] xl:hidden">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">Shortcuts & actions</summary>
            <div className="px-4 pb-4">
              <ShortcutRail mobile />
            </div>
          </details>
        </section>

        <aside className="hidden xl:block">
          <ShortcutRail />
        </aside>
      </div>
    </main>
  );
}
