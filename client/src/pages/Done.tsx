/*
Design note for this file:
- The archive should read like a quiet continuation of Today, not a separate dashboard.
- Keep the interface sparse: thin borders, small navigation, and only the information needed to scan completed work.
*/
import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { formatDueLabel, useHeroApp } from "@/hooks/useHeroApp";

const heroLogo = "/hero-logo.png";

export default function Done() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();
  const projectMap = useMemo(() => new Map(hero.projects.map((project) => [project.id, project.name])), [hero.projects]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== "Tab") return;
      event.preventDefault();
      navigate(event.shiftKey ? "/all" : "/");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  if (!hero.authChecked) {
    return <main className="min-h-screen bg-[#f6f6f3]" />;
  }

  return (
    <main className="min-h-screen bg-[#f6f6f3] px-3 py-3 text-black sm:px-4">
      <div className="mx-auto max-w-5xl border border-black bg-white shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
        <header className="border-b border-black px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm font-semibold">
              <img src={heroLogo} alt="Task Man logo" className="h-8 w-8 rounded-[12px]" />
              <span className="text-[15px] uppercase tracking-[0.18em]">Task Man</span>
            </div>
            <nav className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-black/58">
              <button type="button" onClick={() => navigate("/")} className="hover:text-black">
                Today
              </button>
              <button type="button" onClick={() => navigate("/tomorrow")} className="hover:text-black">
                Tomorrow
              </button>
              <button type="button" onClick={() => navigate("/all")} className="hover:text-black">
                All
              </button>
              <button type="button" onClick={() => navigate("/analytics")} className="hover:text-black">
                Analytics
              </button>
              <span className="text-black">Done</span>
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap gap-5 text-xs uppercase tracking-[0.14em] text-black/48">
            <span>{hero.doneItems.length} archived</span>
            <span>{hero.doneTodayCount} done today</span>
            <span>{hero.streak} day streak</span>
          </div>
        </header>

        <section className="divide-y divide-black/10">
          {hero.doneItems.map((item) => {
            const projectName = item.projectId ? projectMap.get(item.projectId) ?? null : null;
            const completedLabel = formatDueLabel(item.completedAt || item.updatedAt).replace(" · ", " at ");

            return (
              <article key={item.id} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 px-3 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:px-4">
                <div className="pt-1 text-[11px] leading-5 text-black/58 sm:text-xs">{completedLabel}</div>
                <div className="min-w-0">
                  <div className="break-words text-[15px] leading-6 text-black">{item.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-black/45">
                    {projectName ? <span>{projectName}</span> : null}
                    <span>{item.type}</span>
                  </div>
                </div>
              </article>
            );
          })}

          {hero.doneItems.length === 0 ? (
            <div className="px-4 py-12 text-sm leading-7 text-black/62">Nothing archived yet. When you finish tasks from Today, they will appear here.</div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
