/*
Design note for this file:
- Tactile paper dashboard chosen from the brainstorming phase.
- The page should feel like a warm planning surface: pinned tools on the left, live work queue in the middle, focused inspector on the right.
- Preserve the legacy Hero character through speed, visible shortcuts, and a unified list for tasks and saved links.
*/
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHeroApp, toneClassMap, formatDueLabel, getDueMood } from "@/hooks/useHeroApp";
import { cn } from "@/lib/utils";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";
const heroTexture =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-paper-texture-wide_1a663de6.png";
const heroScene =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-dashboard-scene_895ff958.png";
const projectTagsScene =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-project-tags_aac25abe.png";
const mobileScene =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-mobile-planner_5e89fa5c.png";

export default function Home() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const [dueInput, setDueInput] = useState("tomorrow 9am");
  const [type, setType] = useState<"task" | "link">("task");
  const [url, setUrl] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [isRecurringDaily, setIsRecurringDaily] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [rescheduleValue, setRescheduleValue] = useState("");

  useEffect(() => {
    setRenameValue(hero.selectedItem?.title ?? "");
    setRescheduleValue("");
  }, [hero.selectedItem]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        (target as HTMLElement | null)?.isContentEditable;
      if (isTyping) return;

      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        document.getElementById("hero-title-input")?.focus();
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("hero-filter-strip")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (event.key === "u" || event.key === "U") {
        event.preventDefault();
        hero.undoLastAction();
        toast.success("Restored the last item.");
        return;
      }
      if (!hero.upcomingItems.length) return;
      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        const next = hero.upcomingItems[Math.min(hero.selectedIndex + 1, hero.upcomingItems.length - 1)];
        hero.setSelectedId(next.id);
      }
      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        const next = hero.upcomingItems[Math.max(hero.selectedIndex - 1, 0)];
        hero.setSelectedId(next.id);
      }
      if ((event.key === "d" || event.key === "D") && hero.selectedItem) {
        event.preventDefault();
        hero.markDone(hero.selectedItem.id);
        toast.success("Moved to Done.");
      }
      if ((event.key === "x" || event.key === "X" || event.key === "Backspace") && hero.selectedItem) {
        event.preventDefault();
        hero.removeItem(hero.selectedItem.id);
        toast.success("Removed from the queue.");
      }
      if ((event.key === "o" || event.key === "O" || event.key === "Enter") && hero.selectedItem?.type === "link" && hero.selectedItem.url) {
        window.open(hero.selectedItem.url, "_blank", "noopener,noreferrer");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hero]);

  const greeting = useMemo(() => {
    if (!hero.user) return "Hero";
    const firstName = hero.user.name.split(" ")[0];
    return firstName.length > 1 ? firstName : "Hero";
  }, [hero.user]);

  if (!hero.authChecked) {
    return (
      <div className="hero-loading-shell">
        <div className="hero-loading-card">
          <p className="hero-eyebrow">Preparing Hero</p>
          <h1>Loading your queue…</h1>
        </div>
      </div>
    );
  }

  if (!hero.user) {
    return (
      <main className="hero-auth-shell">
        <section className="hero-auth-copy">
          <p className="hero-eyebrow">Hero returns in the browser</p>
          <h1>A fast, opinionated place to defer work until it matters again.</h1>
          <p className="hero-body-copy">
            The new Hero keeps the shortcut-driven spirit of the extension, adds project tagging,
            and is ready for Google login through Supabase.
          </p>
          <div className="hero-auth-actions">
            <Button
              size="lg"
              className="hero-primary-button"
              onClick={async () => {
                const result = await hero.signIn();
                if (!result.ok) toast.error(result.message);
              }}
            >
              Continue with Google
            </Button>
          </div>
        </section>
        <section className="hero-auth-visual">
          <img src={heroScene} alt="Hero planning desk illustration" />
        </section>
      </main>
    );
  }

  return (
    <main className="hero-app-shell" style={{ backgroundImage: `linear-gradient(180deg, rgba(248,243,235,0.94), rgba(243,236,224,0.92)), url(${heroTexture})` }}>
      <section className="hero-left-rail">
        <div className="hero-brand-card">
          <div className="hero-brand-topline">
            <img src={heroMark} alt="Hero mark" className="hero-brand-mark" />
            <div>
              <p className="hero-eyebrow">Keyboard-first task manager</p>
              <h1>Hero</h1>
            </div>
          </div>
          <p>
            Warm, opinionated, and built to resurface the right task or link at the right moment.
          </p>
          <div className="hero-brand-meta">
            <span>{hero.user.mode === "demo" ? "Demo workspace" : "Google session ready"}</span>
            <span>{hero.overdueCount} overdue</span>
          </div>
        </div>

        <div className="hero-visual-card hero-visual-card--desk">
          <img src={heroScene} alt="Desk scene representing the Hero workflow" />
        </div>

        <div className="hero-status-card">
          <p className="hero-eyebrow">Current setup</p>
          <p>{hero.statusMessage}</p>
          <p className="hero-fine-print">
            When you add Supabase keys, Google OAuth can go live. Until then the app behaves like a
            polished local-first prototype.
          </p>
        </div>

        <div className="hero-shortcuts-card">
          <div className="hero-section-heading-row">
            <h2>Legacy-speed shortcuts</h2>
            <span className="hero-chip hero-chip--muted">desktop</span>
          </div>
          <div className="hero-shortcut-grid">
            {hero.legacyShortcutHints.map((shortcut) => (
              <div key={shortcut.key} className="hero-shortcut-row">
                <span className="hero-kbd">{shortcut.key}</span>
                <span>{shortcut.description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hero-main-panel">
        <header className="hero-main-header">
          <div>
            <p className="hero-eyebrow">Good to see you, {greeting}</p>
            <h2>The queue is small on purpose.</h2>
          </div>
          <div className="hero-header-actions">
            <Link href="/done" className="hero-inline-link">
              Done archive
            </Link>
            <Button variant="outline" className="hero-outline-button" onClick={() => hero.setComposerOpen((current) => !current)}>
              {hero.composerOpen ? "Hide quick add" : "Quick add"}
            </Button>
            <Button variant="outline" className="hero-outline-button" onClick={() => hero.signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        <section className={cn("hero-composer-card", hero.composerOpen && "hero-composer-card--open")}>
          <div className="hero-section-heading-row">
            <div>
              <p className="hero-eyebrow">Quick capture</p>
              <h3>Add a task or save a link in one pass</h3>
            </div>
            <div className="hero-type-toggle">
              <button
                type="button"
                className={cn("hero-type-pill", type === "task" && "is-active")}
                onClick={() => setType("task")}
              >
                Task
              </button>
              <button
                type="button"
                className={cn("hero-type-pill", type === "link" && "is-active")}
                onClick={() => setType("link")}
              >
                Link
              </button>
            </div>
          </div>

          <div className="hero-composer-grid">
            <label className="hero-field">
              <span>Title</span>
              <input
                id="hero-title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={type === "task" ? "Cancel that subscription" : "Article worth revisiting later"}
              />
            </label>

            {type === "link" ? (
              <label className="hero-field">
                <span>URL</span>
                <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/story" />
              </label>
            ) : null}

            <label className="hero-field">
              <span>Remind me</span>
              <input value={dueInput} onChange={(event) => setDueInput(event.target.value)} placeholder="Tomorrow at 9am" />
            </label>

            <label className="hero-field">
              <span>Project</span>
              <select value={projectId || ""} onChange={(event) => setProjectId(event.target.value || undefined)}>
                <option value="">No project</option>
                {hero.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="hero-composer-footer">
            <label className="hero-check-row">
              <input type="checkbox" checked={isRecurringDaily} onChange={(event) => setIsRecurringDaily(event.target.checked)} />
              <span>Repeat daily</span>
            </label>
            <p className="hero-fine-print">{hero.formatPreviewFromInput(dueInput)}</p>
            <Button
              className="hero-primary-button"
              onClick={() => {
                const result = hero.saveDraft({ title, dueInput, type, url, projectId, isRecurringDaily });
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }
                toast.success(result.message);
                setTitle("");
                setUrl("");
                setDueInput("tomorrow 9am");
                setIsRecurringDaily(false);
              }}
            >
              Save to Hero
            </Button>
          </div>
        </section>

        <section className="hero-list-card">
          <div id="hero-filter-strip" className="hero-filter-strip">
            {hero.projectOptions.map((project) => (
              <button
                key={project.id}
                type="button"
                className={cn(
                  "hero-project-filter",
                  project.id !== "all" && toneClassMap[project.tone],
                  hero.activeProjectId === project.id && "is-active",
                  project.id === "all" && "hero-project-filter--all",
                )}
                onClick={() => hero.setActiveProjectId(project.id)}
              >
                {project.name}
              </button>
            ))}
          </div>

          <div className="hero-list-heading-row">
            <div>
              <p className="hero-eyebrow">Upcoming</p>
              <h3>{hero.upcomingItems.length} active reminders</h3>
            </div>
            <div className="hero-mini-stats">
              <span>{hero.overdueCount} overdue</span>
              <span>{hero.doneTodayCount} done today</span>
              <span>{hero.streak} day streak</span>
            </div>
          </div>

          <div className="hero-queue">
            {hero.upcomingItems.length ? (
              hero.upcomingItems.map((item) => {
                const project = hero.projects.find((entry) => entry.id === item.projectId);
                const mood = getDueMood(item.dueAt);
                return (
                  <article
                    key={item.id}
                    className={cn(
                      "hero-item-card",
                      hero.selectedId === item.id && "is-selected",
                      mood === "overdue" && "is-overdue",
                      mood === "soon" && "is-soon",
                    )}
                    onClick={() => hero.setSelectedId(item.id)}
                  >
                    <div className="hero-item-main">
                      <div className="hero-item-topline">
                        <span className="hero-item-kind">{item.type === "task" ? "Task" : "Saved link"}</span>
                        {project ? <span className={cn("hero-tag", toneClassMap[project.tone])}>{project.name}</span> : null}
                        {item.isRecurringDaily ? <span className="hero-chip">Daily</span> : null}
                      </div>
                      <h4>{item.title}</h4>
                      <p className="hero-due-label">{formatDueLabel(item.dueAt)}</p>
                      {item.type === "link" && item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="hero-item-link">
                          {item.url}
                        </a>
                      ) : (
                        <p className="hero-fine-print">
                          {item.originalTitle && item.originalTitle !== item.title
                            ? `Originally: ${item.originalTitle}`
                            : "Due tasks open into a focused break-it-down flow."}
                        </p>
                      )}
                    </div>

                    <div className="hero-item-actions">
                      {item.type === "task" ? (
                        <button className="hero-item-action" type="button" onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/due/${item.id}`);
                        }}>
                          Focus
                        </button>
                      ) : null}
                      <button className="hero-item-action" type="button" onClick={(event) => {
                        event.stopPropagation();
                        hero.markDone(item.id);
                        toast.success("Moved to Done.");
                      }}>
                        Done
                      </button>
                      <button className="hero-item-action hero-item-action--danger" type="button" onClick={(event) => {
                        event.stopPropagation();
                        hero.removeItem(item.id);
                        toast.success("Removed from the queue.");
                      }}>
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="hero-empty-state">
                <img src={mobileScene} alt="Mobile planning illustration" />
                <div>
                  <p className="hero-eyebrow">Nothing waiting</p>
                  <h3>Your queue is intentionally clear.</h3>
                  <p>
                    Add a new task or save a link above. Hero works best when it only holds what you genuinely want to revisit.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </section>

      <aside className="hero-right-rail">
        <div className="hero-inspector-card">
          <div className="hero-section-heading-row">
            <div>
              <p className="hero-eyebrow">Selected item</p>
              <h3>{hero.selectedItem ? hero.selectedItem.title : "No active selection"}</h3>
            </div>
            {hero.selectedItem?.type === "task" ? (
              <Link href={`/due/${hero.selectedItem.id}`} className="hero-inline-link">
                Open due view
              </Link>
            ) : null}
          </div>

          {hero.selectedItem ? (
            <>
              <label className="hero-field">
                <span>Rename</span>
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
              </label>
              <Button
                variant="outline"
                className="hero-outline-button hero-full-width"
                onClick={() => {
                  hero.renameItem(hero.selectedItem!.id, renameValue);
                  toast.success("Title updated.");
                }}
              >
                Save title
              </Button>

              <label className="hero-field">
                <span>Reschedule</span>
                <input value={rescheduleValue} onChange={(event) => setRescheduleValue(event.target.value)} placeholder={hero.selectedItem ? `next thursday 3pm · currently ${formatDueLabel(hero.selectedItem.dueAt)}` : "next thursday 3pm"} />
              </label>
              <Button
                variant="outline"
                className="hero-outline-button hero-full-width"
                onClick={() => {
                  const result = hero.rescheduleItem(hero.selectedItem!.id, rescheduleValue);
                  if (!result.ok) {
                    toast.error(result.message);
                    return;
                  }
                  toast.success(result.message);
                }}
              >
                Apply new time
              </Button>
            </>
          ) : (
            <p className="hero-fine-print">Select an item from the queue to rename it, reschedule it, or open its due workflow.</p>
          )}
        </div>

        <div className="hero-due-card">
          <div className="hero-section-heading-row">
            <div>
              <p className="hero-eyebrow">Wake-up mode</p>
              <h3>{hero.dueNowItem ? "One item wants attention" : "No urgent wake-up"}</h3>
            </div>
            <span className={cn("hero-chip", hero.dueNowItem ? "hero-chip--alert" : "hero-chip--muted")}>{hero.dueNowItem ? "Due now" : "Calm"}</span>
          </div>
          {hero.dueNowItem ? (
            <>
              <p className="hero-due-focus-title">{hero.dueNowItem.title}</p>
              <p className="hero-fine-print">The web version cannot force-open tabs like the extension, so Hero elevates one due item into a focused route instead.</p>
              <Button className="hero-primary-button hero-full-width" onClick={() => navigate(`/due/${hero.dueNowItem!.id}`)}>
                Resolve this now
              </Button>
            </>
          ) : (
            <p className="hero-fine-print">Your next due item will appear here once its reminder time arrives.</p>
          )}
        </div>

        <div className="hero-projects-card">
          <div className="hero-section-heading-row">
            <div>
              <p className="hero-eyebrow">Projects</p>
              <h3>User-defined and filterable</h3>
            </div>
          </div>
          <div className="hero-project-art">
            <img src={projectTagsScene} alt="Paper project labels" />
          </div>
          <div className="hero-project-rows">
            {hero.projects.map((project) => (
              <div key={project.id} className="hero-project-row">
                <span className={cn("hero-tag", toneClassMap[project.tone])}>{project.name}</span>
                <span>{hero.items.filter((item) => item.projectId === project.id && item.status === "upcoming").length} active</span>
              </div>
            ))}
          </div>
          <div className="hero-inline-form">
            <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Add a project" />
            <button
              type="button"
              className="hero-inline-add"
              onClick={() => {
                if (!newProjectName.trim()) return;
                hero.addProject(newProjectName);
                toast.success("Project created.");
                setNewProjectName("");
              }}
            >
              Add
            </button>
          </div>
        </div>
      </aside>

      {hero.undoState ? (
        <button type="button" className="hero-undo-toast" onClick={() => {
          hero.undoLastAction();
          toast.success("Restored.");
        }}>
          Undo last action
        </button>
      ) : null}
    </main>
  );
}
