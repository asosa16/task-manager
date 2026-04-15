/*
Design note for this file:
- Chosen philosophy: original Hero, modernized carefully.
- Keep the experience monochrome, centered, and keyboard-first, with the Today list as the visual and functional anchor.
- Prefer thin borders, light-gray surfaces, black emphasis, compact controls, and restrained typography over decorative dashboard patterns.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  formatDueLabel,
  formatPreviewFromInput,
  getDueMood,
  legacyShortcutHints,
  toneClassMap,
  useHeroApp,
} from "@/hooks/useHeroApp";
import { cn } from "@/lib/utils";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function sectionLabel(count: number) {
  if (count === 0) return "Nothing pressing for today.";
  if (count === 1) return "One thing deserves attention today.";
  return `${count} items are active today.`;
}

export default function Home() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();

  const titleInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDueInput, setDraftDueInput] = useState("today 5pm");
  const [draftProjectId, setDraftProjectId] = useState<string>("");
  const [draftType, setDraftType] = useState<"task" | "link">("task");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftRecurring, setDraftRecurring] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState<"signin" | "signup" | null>(null);

  const hostedAuthEnabled = Boolean(import.meta.env.VITE_SUPABASE_URL);

  const projectMap = useMemo(
    () => new Map(hero.projects.map((project) => [project.id, project])),
    [hero.projects],
  );

  const todayItems = useMemo(() => {
    const now = new Date();
    return hero.upcomingItems.filter((item) => {
      const due = new Date(item.dueAt);
      return due.getTime() <= now.getTime() || isSameDay(due, now);
    });
  }, [hero.upcomingItems]);

  const laterItems = useMemo(() => {
    const todayIds = new Set(todayItems.map((item) => item.id));
    return hero.upcomingItems.filter((item) => !todayIds.has(item.id)).slice(0, 6);
  }, [hero.upcomingItems, todayItems]);

  const visibleTodayItems = todayItems.length ? todayItems : hero.upcomingItems.slice(0, 8);

  useEffect(() => {
    setRenameValue(hero.selectedItem?.title ?? "");
    setRescheduleValue("");
  }, [hero.selectedItem]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isField = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;

      if ((event.key === "n" || event.key === "N") && !isField) {
        event.preventDefault();
        hero.setComposerOpen(true);
        window.requestAnimationFrame(() => titleInputRef.current?.focus());
        return;
      }

      if ((event.key === "z" || event.key === "Z" || event.key === "u" || event.key === "U") && !isField) {
        if (!hero.undoState) return;
        event.preventDefault();
        void hero.undoLastAction().then((result) => {
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          toast.success(result.message);
        });
        return;
      }

      if ((event.key === "j" || event.key === "J") && !isField) {
        event.preventDefault();
        const next = hero.upcomingItems[hero.selectedIndex + 1] ?? hero.upcomingItems[hero.selectedIndex];
        if (next) hero.setSelectedId(next.id);
        return;
      }

      if ((event.key === "k" || event.key === "K") && !isField) {
        event.preventDefault();
        const next = hero.upcomingItems[hero.selectedIndex - 1] ?? hero.upcomingItems[0];
        if (next) hero.setSelectedId(next.id);
        return;
      }

      if ((event.key === "d" || event.key === "D") && !isField && hero.selectedItem) {
        event.preventDefault();
        void hero.markDone(hero.selectedItem.id).then((result) => {
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          toast.success(result.message);
        });
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete" || event.key === "x" || event.key === "X") && !isField && hero.selectedItem) {
        event.preventDefault();
        void hero.removeItem(hero.selectedItem.id).then((result) => {
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          toast.success(result.message);
        });
        return;
      }

      if ((event.key === "e" || event.key === "E") && !isField && hero.selectedItem) {
        event.preventDefault();
        window.requestAnimationFrame(() => renameInputRef.current?.focus());
        return;
      }

      if ((event.key === "Enter" || event.key === "o" || event.key === "O") && !isField && hero.selectedItem?.type === "link" && hero.selectedItem.url) {
        event.preventDefault();
        window.open(hero.selectedItem.url, "_blank", "noopener,noreferrer");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hero]);

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
    setDraftUrl("");
    setDraftRecurring(false);
    setDraftProjectId("");
    setDraftType("task");
    setDraftDueInput("today 5pm");
  }

  async function handleRename() {
    if (!hero.selectedItem) return;
    const result = await hero.renameItem(hero.selectedItem.id, renameValue);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Title updated.");
  }

  async function handleReschedule() {
    if (!hero.selectedItem) return;
    const result = await hero.rescheduleItem(hero.selectedItem.id, rescheduleValue);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    setRescheduleValue("");
  }

  async function handleAddProject() {
    if (!newProjectName.trim()) return;
    const result = await hero.addProject(newProjectName);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    setNewProjectName("");
  }

  async function handleSignIn() {
    setAuthBusy("signin");
    const result = hostedAuthEnabled
      ? await hero.signInWithPassword(authEmail, authPassword)
      : await hero.signIn();

    setAuthBusy(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
  }

  async function handleCreateAccount() {
    setAuthBusy("signup");
    const result = hostedAuthEnabled
      ? await hero.signUpWithPassword(authEmail, authPassword)
      : await hero.signIn();

    setAuthBusy(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
  }

  async function handleSignOut() {
    await hero.signOut();
    toast.success("Signed out.");
  }

  if (!hero.authChecked) {
    return (
      <main className="min-h-screen bg-[#f1f3f8] px-4 py-10 text-black">
        <div className="mx-auto max-w-md rounded-sm border border-black/15 bg-white px-6 py-8 shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/50">Hero</p>
          <h1 className="mt-3 text-4xl font-normal leading-none text-black [font-family:Georgia,serif]">Checking your workspace…</h1>
        </div>
      </main>
    );
  }

  if (!hero.user) {
    return (
      <main className="min-h-screen bg-[#f1f3f8] px-4 py-8 text-black">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,620px)_280px]">
          <section className="rounded-sm border border-black/15 bg-white p-8 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
            <div className="flex items-center gap-3">
              <img src={heroMark} alt="Hero mark" className="h-10 w-10 rounded-sm border border-black/10 bg-[#f1f3f8] object-cover" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/50">Keyboard-first task manager</p>
                <h1 className="text-5xl leading-none text-black [font-family:Georgia,serif]">Hero</h1>
              </div>
            </div>

            <div className="mt-10 max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/50">Original rhythm, rebuilt for the web</p>
              <h2 className="mt-3 text-6xl leading-[0.95] text-black [font-family:Georgia,serif] sm:text-7xl">A small, opinionated list for what matters today.</h2>
              <p className="mt-6 max-w-xl text-base leading-7 text-black/70">
                This version keeps Hero fast and shortcut-driven, but adds mobile access, project tags, and hosted sync with a simple email-and-password account.
              </p>

              {hostedAuthEnabled ? (
                <div className="mt-8 max-w-md space-y-4 border border-black/10 bg-[#f7f7f7] p-4">
                  <label className="block space-y-2 text-sm text-black/70">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">Email</span>
                    <input
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="w-full rounded-none border border-black/15 bg-white px-3 py-2 text-base text-black placeholder:text-black/30 focus:outline-none"
                    />
                  </label>
                  <label className="block space-y-2 text-sm text-black/70">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">Password</span>
                    <input
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      type="password"
                      autoComplete="current-password"
                      placeholder="At least 8 characters"
                      className="w-full rounded-none border border-black/15 bg-white px-3 py-2 text-base text-black placeholder:text-black/30 focus:outline-none"
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => void handleSignIn()}
                      disabled={authBusy !== null}
                      className="rounded-sm bg-black px-5 text-white hover:bg-black/90 disabled:opacity-60"
                    >
                      {authBusy === "signin" ? "Signing in…" : "Sign in"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleCreateAccount()}
                      disabled={authBusy !== null}
                      className="rounded-sm border-black/15 bg-white px-5 text-black hover:bg-black hover:text-white disabled:opacity-60"
                    >
                      {authBusy === "signup" ? "Creating account…" : "Create account"}
                    </Button>
                  </div>
                  <p className="text-xs leading-6 text-black/55">
                    Google login can be added later. For now, Hero uses Supabase email/password authentication.
                  </p>
                </div>
              ) : (
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button onClick={() => void handleSignIn()} className="rounded-sm bg-black px-5 text-white hover:bg-black/90">
                    Open demo workspace
                  </Button>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4 rounded-sm border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/50">Current setup</p>
              <p className="mt-3 text-sm leading-6 text-black/70">{hero.statusMessage}</p>
            </div>
            <div className="border-t border-black/10 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/50">Core shortcuts</p>
              <div className="mt-3 space-y-2">
                {legacyShortcutHints.map((hint) => (
                  <div key={hint.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-black/70">{hint.description}</span>
                    <span className="rounded-sm border border-black/15 bg-[#f6f7fb] px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-black/70">
                      {hint.key}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f1f3f8] px-3 py-4 text-black sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[1250px]">
        <header className="grid gap-4 border-b border-black/10 pb-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="flex items-start gap-3">
            <img src={heroMark} alt="Hero mark" className="mt-1 h-9 w-9 rounded-sm border border-black/10 bg-white object-cover" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">{hero.user.mode === "demo" ? "Demo workspace" : hero.user.email}</p>
              <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                <h1 className="text-5xl leading-none text-black [font-family:Georgia,serif]">Hero</h1>
                <div className="flex items-center gap-3 pb-1 text-sm text-black/60">
                  <span className="font-medium">Today</span>
                  <Link href="/done" className="underline decoration-black/20 underline-offset-4 hover:decoration-black">Done</Link>
                </div>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-black/65">{hero.statusMessage}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button variant="outline" className="rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => {
              hero.setComposerOpen(true);
              window.requestAnimationFrame(() => titleInputRef.current?.focus());
            }}>
              Quick add
            </Button>
            <Button variant="outline" className="rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[1fr_minmax(0,830px)_240px]">
          <aside className="hidden xl:block" />

          <section className="min-w-0">
            <div className="rounded-sm border border-black/15 bg-white shadow-[0_12px_35px_rgba(0,0,0,0.05)]">
              <div className="border-b border-black/10 px-5 py-4 sm:px-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/50">Today</p>
                <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                  <h2 className="text-6xl leading-none text-black [font-family:Georgia,serif] sm:text-7xl">Today</h2>
                  <div className="text-right text-sm text-black/60">
                    <div>{sectionLabel(visibleTodayItems.length)}</div>
                    <div>{hero.overdueCount} overdue · {hero.doneTodayCount} done today · {hero.streak} day streak</div>
                  </div>
                </div>
              </div>

              {hero.composerOpen ? (
                <div className="border-b border-black px-5 py-5 text-white sm:px-6" style={{ backgroundColor: "#111" }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">Quick capture</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={cn(
                          "rounded-sm border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition",
                          draftType === "task"
                            ? "border-white bg-white text-black"
                            : "border-white/20 bg-transparent text-white/70 hover:text-white",
                        )}
                        onClick={() => setDraftType("task")}
                      >
                        Task
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-sm border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition",
                          draftType === "link"
                            ? "border-white bg-white text-black"
                            : "border-white/20 bg-transparent text-white/70 hover:text-white",
                        )}
                        onClick={() => setDraftType("link")}
                      >
                        Link
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="space-y-2 text-sm text-white/75">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Title</span>
                      <input
                        id="hero-title-input"
                        ref={titleInputRef}
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        placeholder={draftType === "task" ? "Renew passport" : "Read: quiet software tools"}
                        className="w-full rounded-none border-0 border-l-2 border-white bg-transparent px-3 py-2 text-base text-white placeholder:text-white/30 focus:outline-none"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-white/75">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Remind me</span>
                      <input
                        value={draftDueInput}
                        onChange={(event) => setDraftDueInput(event.target.value)}
                        placeholder="today 5pm"
                        className="w-full rounded-none border-0 border-l-2 border-white bg-transparent px-3 py-2 text-base text-white placeholder:text-white/30 focus:outline-none"
                      />
                    </label>
                    {draftType === "link" ? (
                      <label className="space-y-2 text-sm text-white/75 md:col-span-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">URL</span>
                        <input
                          value={draftUrl}
                          onChange={(event) => setDraftUrl(event.target.value)}
                          placeholder="https://example.com/article"
                          className="w-full rounded-none border-0 border-l-2 border-white bg-transparent px-3 py-2 text-base text-white placeholder:text-white/30 focus:outline-none"
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <select
                      value={draftProjectId}
                      onChange={(event) => setDraftProjectId(event.target.value)}
                      className="min-w-[180px] rounded-none border border-white/20 bg-transparent px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="" className="text-black">No project</option>
                      {hero.projects.map((project) => (
                        <option key={project.id} value={project.id} className="text-black">
                          {project.name}
                        </option>
                      ))}
                    </select>

                    <label className="flex items-center gap-2 text-sm text-white/75">
                      <input type="checkbox" checked={draftRecurring} onChange={(event) => setDraftRecurring(event.target.checked)} />
                      Repeat daily
                    </label>

                    <Button onClick={() => void handleSaveDraft()} className="rounded-sm bg-white text-black hover:bg-white/90">
                      Save to Hero
                    </Button>
                    <button type="button" className="text-sm text-white/60 underline underline-offset-4 hover:text-white" onClick={() => hero.setComposerOpen(false)}>
                      Close
                    </button>
                  </div>

                  <p className="mt-3 text-sm text-white/55">{formatPreviewFromInput(draftDueInput)}</p>
                </div>
              ) : null}

              <div className="border-b border-black/10 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap gap-2">
                  {hero.projectOptions.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => hero.setActiveProjectId(project.id)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition",
                        hero.activeProjectId === project.id
                          ? "border-black bg-black text-white"
                          : project.id === "all"
                            ? "border-black/15 bg-white text-black hover:border-black hover:bg-black hover:text-white"
                            : cn("hover:border-black", toneClassMap[project.tone]),
                      )}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-4 sm:px-6">
                <div className="hidden grid-cols-[150px_minmax(0,1fr)_120px_176px] gap-4 border-b border-black/10 pb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45 md:grid">
                  <div>When</div>
                  <div>Task</div>
                  <div>Project</div>
                  <div>Actions</div>
                </div>

                <div className="divide-y divide-black/8">
                  {visibleTodayItems.length ? (
                    visibleTodayItems.map((item) => {
                      const project = item.projectId ? projectMap.get(item.projectId) : null;
                      const mood = getDueMood(item.dueAt);
                      return (
                        <article
                          key={item.id}
                          className={cn(
                            "grid gap-3 py-4 md:grid-cols-[150px_minmax(0,1fr)_120px_176px] md:items-start",
                            hero.selectedItem?.id === item.id && "bg-black/[0.02]",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => hero.setSelectedId(item.id)}
                            className="text-left"
                          >
                            <p className={cn("text-sm font-medium", mood === "overdue" ? "text-black" : "text-black/60")}>{formatDueLabel(item.dueAt)}</p>
                            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/35">
                              {mood === "overdue" ? "Overdue" : mood === "soon" ? "Due soon" : "Scheduled"}
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={() => hero.setSelectedId(item.id)}
                            className="text-left"
                          >
                            <p className="text-lg leading-7 text-black">{item.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-black/55">
                              <span>{item.type === "task" ? "Task" : "Saved link"}</span>
                              {item.url ? (
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline decoration-black/20 underline-offset-4 hover:decoration-black"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  Open link
                                </a>
                              ) : null}
                              {item.brokenDownFromId ? <span>Broken down once</span> : null}
                            </div>
                          </button>

                          <div>
                            {project ? (
                              <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]", toneClassMap[project.tone])}>
                                {project.name}
                              </span>
                            ) : (
                              <span className="text-xs uppercase tracking-[0.14em] text-black/35">—</span>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <button
                              type="button"
                              className="rounded-sm border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-black hover:bg-black hover:text-white"
                              onClick={() => {
                                hero.setSelectedId(item.id);
                                navigate(`/due/${item.id}`);
                              }}
                            >
                              Focus
                            </button>
                            <button
                              type="button"
                              className="rounded-sm border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-black hover:bg-black hover:text-white"
                              onClick={() => {
                                void hero.markDone(item.id).then((result) => {
                                  if (!result.ok) {
                                    toast.error(result.message);
                                    return;
                                  }
                                  toast.success(result.message);
                                });
                              }}
                            >
                              Done
                            </button>
                            <button
                              type="button"
                              className="rounded-sm border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-black hover:bg-black hover:text-white"
                              onClick={() => {
                                void hero.removeItem(item.id).then((result) => {
                                  if (!result.ok) {
                                    toast.error(result.message);
                                    return;
                                  }
                                  toast.success(result.message);
                                });
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="py-10">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Today</p>
                      <h3 className="mt-2 text-4xl leading-none text-black [font-family:Georgia,serif]">A clear page.</h3>
                      <p className="mt-4 max-w-xl text-sm leading-6 text-black/65">
                        There is nothing due today. Use quick add to place the next thing where it belongs.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <section className="rounded-sm border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
                <div className="flex items-end justify-between gap-3 border-b border-black/10 pb-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Later</p>
                    <h3 className="mt-1 text-4xl leading-none text-black [font-family:Georgia,serif]">Next up</h3>
                  </div>
                  <Link href="/done" className="text-sm text-black/60 underline decoration-black/20 underline-offset-4 hover:decoration-black">
                    View done archive
                  </Link>
                </div>
                <div className="mt-4 space-y-3">
                  {laterItems.length ? (
                    laterItems.map((item) => {
                      const project = item.projectId ? projectMap.get(item.projectId) : null;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => hero.setSelectedId(item.id)}
                          className="flex w-full items-start justify-between gap-3 border border-black/10 bg-[#fafbfe] px-4 py-3 text-left hover:border-black/25"
                        >
                          <div>
                            <p className="text-sm font-medium text-black">{item.title}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/45">{formatDueLabel(item.dueAt)}</p>
                          </div>
                          {project ? <span className={cn("rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]", toneClassMap[project.tone])}>{project.name}</span> : null}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm leading-6 text-black/60">Later items will appear here once today is under control.</p>
                  )}
                </div>
              </section>

              <aside className="space-y-5">
                <section className="rounded-sm border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Selected item</p>
                  {hero.selectedItem ? (
                    <div className="mt-3 space-y-4">
                      <div>
                        <h3 className="text-4xl leading-none text-black [font-family:Georgia,serif]">{hero.selectedItem.title}</h3>
                        <p className="mt-3 text-sm leading-6 text-black/65">{formatDueLabel(hero.selectedItem.dueAt)}</p>
                      </div>

                      <label className="block text-sm text-black/65">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">Rename</span>
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          className="mt-2 w-full border border-black/15 bg-[#fafbfe] px-3 py-2 text-black outline-none focus:border-black"
                        />
                      </label>
                      <Button variant="outline" className="w-full rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => void handleRename()}>
                        Save title
                      </Button>

                      <label className="block text-sm text-black/65">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">Reschedule</span>
                        <input
                          value={rescheduleValue}
                          onChange={(event) => setRescheduleValue(event.target.value)}
                          placeholder={hero.selectedItem ? `next thursday 3pm · currently ${formatDueLabel(hero.selectedItem.dueAt)}` : "next thursday 3pm"}
                          className="mt-2 w-full border border-black/15 bg-[#fafbfe] px-3 py-2 text-black outline-none focus:border-black"
                        />
                      </label>
                      <Button variant="outline" className="w-full rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => void handleReschedule()}>
                        Apply new time
                      </Button>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => navigate(`/due/${hero.selectedItem?.id}`)}>
                          Open due view
                        </Button>
                        {hero.selectedItem.url ? (
                          <a
                            href={hero.selectedItem.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-sm border border-black/15 bg-white px-3 py-2 text-sm text-black hover:bg-black hover:text-white"
                          >
                            Open link
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-black/60">Select a task to rename it, reschedule it, or open its focused due view.</p>
                  )}
                </section>

                <section className="rounded-sm border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Shortcuts</p>
                  <div className="mt-3 space-y-2">
                    {legacyShortcutHints.map((hint) => (
                      <div key={hint.key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-black/70">{hint.description}</span>
                        <span className="rounded-sm border border-black/15 bg-[#f6f7fb] px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-black/70">
                          {hint.key}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-sm border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Projects</p>
                  <div className="mt-3 space-y-2">
                    {hero.projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => hero.setActiveProjectId(project.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 border px-3 py-2 text-left text-sm hover:border-black",
                          hero.activeProjectId === project.id ? "border-black bg-black text-white" : "border-black/10 bg-[#fafbfe] text-black",
                        )}
                      >
                        <span>{project.name}</span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]", toneClassMap[project.tone])}>
                          tag
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <input
                      value={newProjectName}
                      onChange={(event) => setNewProjectName(event.target.value)}
                      placeholder="Add a project"
                      className="min-w-0 flex-1 border border-black/15 bg-[#fafbfe] px-3 py-2 text-sm text-black outline-none focus:border-black"
                    />
                    <Button variant="outline" className="rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => void handleAddProject()}>
                      Add
                    </Button>
                  </div>
                </section>
              </aside>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-sm border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Wake-up mode</p>
              {hero.dueNowItem ? (
                <div className="mt-3 space-y-4">
                  <h3 className="text-4xl leading-none text-black [font-family:Georgia,serif]">One item wants attention.</h3>
                  <div>
                    <p className="text-base text-black">{hero.dueNowItem.title}</p>
                    <p className="mt-2 text-sm text-black/60">{formatDueLabel(hero.dueNowItem.dueAt)}</p>
                  </div>
                  <Button className="w-full rounded-sm bg-black text-white hover:bg-black/90" onClick={() => navigate(`/due/${hero.dueNowItem?.id}`)}>
                    Open due view
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-3 text-sm leading-6 text-black/60">
                  <h3 className="text-3xl leading-none text-black [font-family:Georgia,serif]">Quiet for now.</h3>
                  <p>No overdue items are asking for focus.</p>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>

      {hero.undoState ? (
        <div className="fixed bottom-4 right-4 border border-black/15 bg-black px-4 py-3 text-sm text-white shadow-[0_15px_35px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-3">
            <span>Undo last action?</span>
            <button type="button" className="underline underline-offset-4" onClick={() => {
              void hero.undoLastAction().then((result) => {
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }
                toast.success(result.message);
              });
            }}>
              Undo
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
