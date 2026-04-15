/*
Design note for this file:
- Keep the due flow severe, simple, and legible.
- The page should feel like a focused intervention screen drawn from the original Hero utility aesthetic.
- Prefer black, white, and gray structure with one dominant action at a time.
*/
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDueLabel, toneClassMap, useHeroApp } from "@/hooks/useHeroApp";
import { cn } from "@/lib/utils";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";

export default function Due() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();
  const [matched, params] = useRoute("/due/:id");
  const routeId = matched ? params.id : null;

  const item = useMemo(() => {
    if (routeId) {
      return hero.items.find((entry) => entry.id === routeId) ?? null;
    }
    return hero.selectedItem;
  }, [hero.items, hero.selectedItem, routeId]);

  const project = item?.projectId ? hero.projects.find((entry) => entry.id === item.projectId) : null;
  const [smallerStep, setSmallerStep] = useState("");
  const [resnooze, setResnooze] = useState("tomorrow 9am");

  useEffect(() => {
    if (!item) return;
    setSmallerStep(item.title);
  }, [item]);

  useEffect(() => {
    if (item) {
      hero.setSelectedId(item.id);
    }
  }, [hero, item]);

  async function handleBreakDown() {
    if (!item) return;
    const result = await hero.breakDownAndResnooze(item.id, smallerStep, resnooze);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    navigate("/");
  }

  async function handleDone() {
    if (!item) return;
    const result = await hero.markDone(item.id);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    navigate("/done");
  }

  if (!hero.authChecked) {
    return <main className="min-h-screen bg-[#f1f3f8]" />;
  }

  if (!item) {
    return (
      <main className="min-h-screen bg-[#f1f3f8] px-4 py-6 text-black">
        <div className="mx-auto max-w-4xl border border-black/15 bg-white p-6 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Hero</p>
          <h1 className="mt-3 text-5xl leading-none text-black [font-family:Georgia,serif]">Nothing due is selected.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-black/65">Go back to Today and open the focused due view from a task row.</p>
          <div className="mt-6">
            <Link href="/" className="inline-flex items-center border border-black/15 bg-white px-4 py-2 text-sm text-black hover:bg-black hover:text-white">
              Back to Today
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f1f3f8] px-3 py-4 text-black sm:px-4 sm:py-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/10 pb-4">
          <div className="flex items-start gap-3">
            <img src={heroMark} alt="Hero mark" className="mt-1 h-9 w-9 rounded-sm border border-black/10 bg-white object-cover" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Wake-up mode</p>
              <h1 className="text-5xl leading-none text-black [font-family:Georgia,serif]">Due</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="inline-flex items-center border border-black/15 bg-white px-4 py-2 text-sm text-black hover:bg-black hover:text-white">
              Back to Today
            </Link>
            <Link href="/done" className="inline-flex items-center border border-black/15 bg-white px-4 py-2 text-sm text-black hover:bg-black hover:text-white">
              Done archive
            </Link>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="border border-black/15 bg-white shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
            <div className="border-b border-black bg-black px-5 py-5 text-white sm:px-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">Current item</p>
              <h2 className="mt-3 text-5xl leading-[0.95] [font-family:Georgia,serif] sm:text-6xl">{item.title}</h2>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white/70">
                <span>{formatDueLabel(item.dueAt)}</span>
                <span>•</span>
                <span>{item.type === "task" ? "Task" : "Saved link"}</span>
                {project ? (
                  <span className={cn("rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]", toneClassMap[project.tone])}>
                    {project.name}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-6 p-5 sm:p-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Break it down</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-black/65">
                  When a task is due and still too large, Hero turns it into a smaller next step and sends it back into the queue with a new reminder.
                </p>
              </div>

              <label className="block text-sm text-black/70">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">Smaller next step</span>
                <textarea
                  value={smallerStep}
                  onChange={(event) => setSmallerStep(event.target.value)}
                  className="mt-2 min-h-[120px] w-full border border-black/15 bg-[#fafbfe] px-4 py-3 text-base text-black outline-none focus:border-black"
                />
              </label>

              <label className="block text-sm text-black/70">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">Resnooze for</span>
                <input
                  value={resnooze}
                  onChange={(event) => setResnooze(event.target.value)}
                  placeholder="tomorrow 9am"
                  className="mt-2 w-full border border-black/15 bg-[#fafbfe] px-4 py-3 text-base text-black outline-none focus:border-black"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void handleBreakDown()} className="rounded-sm bg-black px-5 text-white hover:bg-black/90">
                  Save smaller step and resnooze
                </Button>
                <Button variant="outline" className="rounded-sm border-black/15 bg-white text-black hover:bg-black hover:text-white" onClick={() => void handleDone()}>
                  Resolve this now
                </Button>
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Original task</p>
              <p className="mt-3 text-base leading-7 text-black">{item.originalTitle || item.title}</p>
              {item.brokenDownFromId ? (
                <p className="mt-3 text-sm leading-6 text-black/60">This item has already been broken down once. Keep the next step specific and finite.</p>
              ) : (
                <p className="mt-3 text-sm leading-6 text-black/60">If you can finish it immediately, skip the resnooze and resolve it now.</p>
              )}
            </section>

            {item.url ? (
              <section className="border border-black/15 bg-white p-5 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">Source link</p>
                <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm text-black underline decoration-black/20 underline-offset-4 hover:decoration-black">
                  Open original link
                </a>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
