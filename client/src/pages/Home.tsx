/*
Design note for this file:
- Match the original Hero extension more closely: tiny header, centered list, restrained monochrome styling, and keyboard-first flow.
- The list is the product. Remove dashboard framing, large marketing copy, and secondary panels that compete with the Today table.
- Keep web-specific needs thin: compact auth, mobile-safe layout, and project tags without visual noise.
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
        if (hero.selectedItem.type === "link" && hero.selectedItem.url) {
          window.open(hero.selectedItem.url, "_blank", "noopener,noreferrer");
          return;
        }
        if (isTodayOrOverdue(hero.selectedItem.dueAt)) {
          navigate(`/due/${hero.selectedItem.id}`);
        }
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
      <main className="min-h-screen bg-[#eef0f3] px-4 py-8 text-black">
        <div className="mx-auto max-w-md border border-black bg-white px-5 py-4 text-sm">
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
      <main className="min-h-screen bg-[#eef0f3] px-4 py-8 text-black">
        <div className="mx-auto max-w-md border border-black bg-white px-5 py-4">
          <div className="flex items-center gap-2 border-b border-black pb-3">
            <img src={heroMark} alt="Hero" className="h-5 w-5" />
            <span className="text-lg font-semibold">Hero</span>
          </div>

          <p className="mt-4 text-sm leading-6 text-black/75">
            A fast, opinionated task list built around shortcuts.
          </p>

          {hostedAuthEnabled ? (
            <div className="mt-4 space-y-3 text-sm">
              <input
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                type="email"
                autoComplete="email"
                placeholder="email"
                className="w-full border border-black bg-white px-3 py-2 outline-none"
              />
              <input
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="password"
                className="w-full border border-black bg-white px-3 py-2 outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSignIn()}
                  disabled={authBusy !== null}
                  className="border border-black bg-black px-3 py-2 text-white disabled:opacity-50"
                >
                  {authBusy === "signin" ? "Signing in..." : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateAccount()}
                  disabled={authBusy !== null}
                  className="border border-black bg-white px-3 py-2 text-black disabled:opacity-50"
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
                className="border border-black bg-black px-3 py-2 text-white"
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
    <main className="min-h-screen overflow-hidden bg-[#eef0f3] text-black">
      <div className="grid min-h-screen grid-rows-[50px_1fr_20px]">
        <header className="border-b border-black bg-white px-4">
          <div className="mx-auto grid h-full max-w-[1240px] grid-cols-2 items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <img src={heroMark} alt="Hero" className="h-5 w-5" />
              <span className="font-semibold">Hero</span>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  openComposer();
                }}
                className="border border-black bg-black px-2 py-1 text-white"
              >
                New
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="border border-black bg-white px-2 py-1"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 px-3 py-3 lg:grid-cols-[1fr_minmax(680px,830px)_220px] lg:gap-3">
          <div className="hidden lg:block" />

          <section className="min-w-0">
            <div className="border border-black bg-white">
              <div className="border-b border-black px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{hero.user.mode === "demo" ? "Demo" : hero.user.email}</span>
                  </div>
                  <div className="flex items-center gap-3 text-black/70">
                    <span>{todayItems.length} today</span>
                    <span>{hero.doneTodayCount} done</span>
                  </div>
                </div>

                <div className="mt-3 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[28px] font-semibold leading-none">Today</div>
                    <div className="mt-1 text-xs text-black/70">{hero.statusMessage}</div>
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
                  <div className="max-w-[420px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[13px] leading-5 text-white/70">
                        <div className="font-semibold text-white/80">Task</div>
                        <div className="text-[11px]">Tab to wake-up time. Shift+Enter also saves.</div>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setDraftType("task")}
                          className={`border px-2 py-1 ${draftType === "task" ? "border-white bg-white text-black" : "border-white/50 bg-black text-white"}`}
                        >
                          Task
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraftType("link")}
                          className={`border px-2 py-1 ${draftType === "link" ? "border-white bg-white text-black" : "border-white/50 bg-black text-white"}`}
                        >
                          Link
                        </button>
                      </div>
                    </div>

                    <input
                      ref={titleInputRef}
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => handleComposerFieldKeyDown(event, "title")}
                      placeholder="Example: Cancel spotify subscription"
                      className="mt-2 w-full border-0 border-l border-white bg-black px-3 py-2 text-sm outline-none placeholder:text-white/45"
                    />

                    <div className="mt-4 text-[13px] font-semibold text-white/80">Remind me</div>
                    <input
                      ref={composerDueInputRef}
                      value={draftDueInput}
                      onChange={(event) => setDraftDueInput(event.target.value)}
                      onKeyDown={(event) => handleComposerFieldKeyDown(event, "due")}
                      placeholder="Try: 8 am, in 2 hours, aug 7, today 12:30pm"
                      className="mt-2 w-full border-0 border-l border-white bg-black px-3 py-2 text-sm outline-none placeholder:text-white/45"
                    />
                    <div className="mt-2 min-h-9 w-full bg-[#363636] px-3 py-2 text-[12px] text-white">{reminderPreview}</div>

                    {draftType === "link" ? (
                      <input
                        ref={urlInputRef}
                        value={draftUrl}
                        onChange={(event) => setDraftUrl(event.target.value)}
                        onKeyDown={(event) => handleComposerFieldKeyDown(event, "url")}
                        placeholder="https://..."
                        className="mt-3 w-full border-0 border-l border-white bg-black px-3 py-2 text-sm outline-none placeholder:text-white/45"
                      />
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px]">
                      <div>
                        press <kbd className="border border-white/50 bg-[#5a5a5a] px-1.5 py-[1px] font-mono text-[10px] text-white">enter</kbd> to submit
                      </div>
                      <label className="flex items-center gap-2 text-white/75">
                        <input
                          checked={draftRecurring}
                          onChange={(event) => setDraftRecurring(event.target.checked)}
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-white"
                        />
                        Everyday
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-white/75">Project</span>
                      <select
                        ref={projectSelectRef}
                        value={draftProjectId}
                        onChange={(event) => setDraftProjectId(event.target.value)}
                        onKeyDown={(event) => handleComposerFieldKeyDown(event, "project")}
                        className="min-w-[160px] border border-white/50 bg-black px-2 py-1.5 text-[12px] text-white outline-none"
                      >
                        <option value="">No project</option>
                        {hero.projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => closeComposer()} className="border border-white/50 bg-black px-2 py-1.5 text-white">
                        Cancel
                      </button>
                      <button type="submit" className="hidden">
                        Save task
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}

              <div className="overflow-x-auto px-4 py-4">
                <table className="w-full border-collapse text-sm">
                  <colgroup>
                    <col className="w-[170px]" />
                    <col />
                    <col className="w-[130px]" />
                    <col className="w-[70px]" />
                  </colgroup>
                  <tbody>
                    {visibleItems.map((item) => {
                      const selected = hero.selectedId === item.id;
                      const isDue = isTodayOrOverdue(item.dueAt);
                      return (
                        <tr
                          key={item.id}
                          onClick={() => hero.setSelectedId(item.id)}
                          className={selected ? "bg-[#eceef2]" : "bg-white hover:bg-[#f5f6f8]"}
                        >
                          <td className="border-b border-black/15 px-2 py-2 align-top text-xs text-black/70">{formatDueLabel(item.dueAt)}</td>
                          <td className="border-b border-black/15 px-2 py-2 align-top">
                            <div className="flex items-start gap-2">
                              <span className="mt-[2px] inline-block h-2 w-2 border border-black bg-white" />
                              <div>
                                <div className="leading-5 text-black">
                                  {item.title}
                                  {item.type === "link" ? <span className="ml-2 text-xs text-black/45">link</span> : null}
                                  {item.isRecurringDaily ? <span className="ml-2 text-xs text-black/45">daily</span> : null}
                                  {isDue ? <span className="ml-2 text-xs font-semibold text-black">today</span> : null}
                                </div>
                                {selected ? (
                                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_160px_auto_auto] sm:items-center">
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
                                      className="border border-black bg-white px-2 py-1.5 outline-none"
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
                                      className="border border-black bg-white px-2 py-1.5 outline-none"
                                    />
                                    <button type="button" onClick={() => void handleRename()} className="border border-black bg-white px-2 py-1.5">
                                      Rename
                                    </button>
                                    <button type="button" onClick={() => void handleReschedule()} className="border border-black bg-white px-2 py-1.5">
                                      Edit time
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="border-b border-black/15 px-2 py-2 align-top text-xs text-black/65">
                            {item.projectId ? projectMap.get(item.projectId) ?? "—" : "—"}
                          </td>
                          <td className="border-b border-black/15 px-2 py-2 align-top text-right">
                            <div className="flex justify-end gap-1">
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {visibleItems.length === 0 ? (
                  <div className="py-8 text-sm text-black/65">No items here yet. Press <span className="border border-black px-1">N</span> to add one.</div>
                ) : null}
              </div>

              <div className="border-t border-black px-4 py-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_220px] sm:items-start">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => hero.setActiveProjectId("all")}
                      className={`border px-2 py-1 ${hero.activeProjectId === "all" ? "border-black bg-black text-white" : "border-black bg-white text-black"}`}
                    >
                      All
                    </button>
                    {hero.projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => hero.setActiveProjectId(project.id)}
                        className={`border px-2 py-1 ${hero.activeProjectId === project.id ? "border-black bg-black text-white" : "border-black bg-white text-black"}`}
                      >
                        {project.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 text-xs">
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
                      className="min-w-0 flex-1 border border-black bg-white px-2 py-1.5 outline-none"
                    />
                    <button type="button" onClick={() => void handleAddProject()} className="border border-black bg-white px-2 py-1.5">
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="mt-3 border border-black bg-[#e4e6ea] p-3 lg:mt-0">
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td colSpan={2} className="pb-2 font-semibold">Navigation</td>
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
                  <td colSpan={2} className="pt-3 pb-2 font-semibold">Actions</td>
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
          </aside>
        </div>

        <footer />
      </div>
    </main>
  );
}
