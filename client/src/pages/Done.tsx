/*
Design note for this file:
- The done archive should feel tidy, quiet, and archival.
- Keep the monochrome Hero language: centered content, light-gray surfaces, thin borders, and understated momentum.
- Treat completion as evidence, not celebration.
*/
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { formatDueLabel, toneClassMap, useHeroApp } from "@/hooks/useHeroApp";
import { cn } from "@/lib/utils";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";

export default function Done() {
  const hero = useHeroApp();
  const latestFive = hero.doneItems.slice(0, 5);

  return (
    <main className="min-h-screen bg-[#f1f3f8] px-3 py-4 text-black sm:px-4 sm:py-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/10 pb-4">
          <div className="flex items-start gap-3">
            <img src={heroMark} alt="Hero mark" className="mt-1 h-9 w-9 rounded-sm border border-black/10 bg-white object-cover" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Done archive</p>
              <h1 className="text-5xl leading-none text-black [font-family:Georgia,serif] sm:text-6xl">Done</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="inline-flex items-center border border-black/15 bg-white px-4 py-2 text-sm text-black hover:bg-black hover:text-white">
              Back to Today
            </Link>
            <Button variant="outline" className="rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => void hero.signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="border border-black/15 bg-white shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
            <div className="border-b border-black/10 px-5 py-4 sm:px-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Archive</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
                <h2 className="text-5xl leading-none text-black [font-family:Georgia,serif] sm:text-6xl">Proof of motion.</h2>
                <div className="text-right text-sm text-black/60">
                  <div>{hero.doneItems.length} archived</div>
                  <div>{hero.doneTodayCount} done today · {hero.streak} day streak</div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 sm:px-6">
              <div className="hidden grid-cols-[170px_minmax(0,1fr)_120px] gap-4 border-b border-black/10 pb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45 md:grid">
                <div>Completed</div>
                <div>Item</div>
                <div>Project</div>
              </div>

              <div className="divide-y divide-black/8">
                {hero.doneItems.length ? (
                  hero.doneItems.map((item) => {
                    const project = item.projectId ? hero.projects.find((entry) => entry.id === item.projectId) : null;
                    return (
                      <article key={item.id} className="grid gap-3 py-4 md:grid-cols-[170px_minmax(0,1fr)_120px] md:items-start">
                        <div>
                          <p className="text-sm font-medium text-black">{formatDueLabel(item.completedAt || item.updatedAt)}</p>
                          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/35">Archived</p>
                        </div>
                        <div>
                          <p className="text-lg leading-7 text-black">{item.title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-black/55">
                            <span>{item.type === "task" ? "Task" : "Saved link"}</span>
                            {item.url ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline decoration-black/20 underline-offset-4 hover:decoration-black"
                              >
                                Open link
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <div>
                          {project ? (
                            <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]", toneClassMap[project.tone])}>
                              {project.name}
                            </span>
                          ) : (
                            <span className="text-xs uppercase tracking-[0.14em] text-black/35">—</span>
                          )}
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="py-10">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Archive</p>
                    <h3 className="mt-2 text-4xl leading-none text-black [font-family:Georgia,serif]">Nothing archived yet.</h3>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-black/65">The done view will start filling as soon as you clear tasks from Today.</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Latest rhythm</p>
              <div className="mt-4 space-y-3">
                {latestFive.length ? (
                  latestFive.map((item, index) => (
                    <div key={item.id} className="flex items-start gap-3 border border-black/10 bg-[#fafbfe] px-4 py-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/15 bg-white text-[11px] font-semibold uppercase tracking-[0.14em] text-black/60">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium leading-6 text-black">{item.title}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/45">{formatDueLabel(item.completedAt || item.updatedAt)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-black/60">Once you complete a few items, the most recent rhythm will appear here.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
