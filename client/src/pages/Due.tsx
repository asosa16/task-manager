/*
Design note for this file:
- The due flow should feel like a sharp intervention, not a dramatic product experience.
- Preserve the original Hero idea: either finish the item now or cut it into a smaller step and resnooze it.
- Keep typography compact, structure plain, and the actions unmistakably primary.
*/
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { formatDueLabel, useHeroApp } from "@/hooks/useHeroApp";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";

function isEditingField(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(element?.isContentEditable);
}

export default function Due() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();
  const [matched, params] = useRoute("/due/:id");
  const routeId = matched ? params.id : null;

  const item = useMemo(() => {
    if (routeId) return hero.items.find((entry) => entry.id === routeId) ?? null;
    return hero.selectedItem;
  }, [hero.items, hero.selectedItem, routeId]);

  const project = item?.projectId ? hero.projects.find((entry) => entry.id === item.projectId) ?? null : null;
  const [smallerStep, setSmallerStep] = useState("");
  const [resnooze, setResnooze] = useState("tomorrow 9am");

  useEffect(() => {
    if (!item) return;
    hero.setSelectedId(item.id);
    setSmallerStep(item.title);
  }, [hero, item]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!item || isEditingField(event.target)) return;

      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        navigate("/");
        return;
      }

      if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        void handleDone();
        return;
      }

      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void handleBreakDown();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, navigate, smallerStep, resnooze]);

  async function handleBreakDown() {
    if (!item) return;
    const result = await hero.breakDownAndResnooze(item.id, smallerStep, resnooze);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    navigate("/");
  }

  async function handleDone() {
    if (!item) return;
    const result = await hero.markDone(item.id);
    if (!result.ok) return toast.error(result.message);
    toast.success(result.message);
    navigate("/done");
  }

  if (!hero.authChecked) {
    return <main className="min-h-screen bg-[#eef0f3]" />;
  }

  if (!item) {
    return (
      <main className="min-h-screen bg-[#eef0f3] px-4 py-8 text-black">
        <div className="mx-auto max-w-2xl border border-black bg-white px-5 py-4">
          <div className="flex items-center gap-2 border-b border-black pb-3 text-sm">
            <img src={heroMark} alt="Hero" className="h-5 w-5" />
            <span className="font-semibold">Hero</span>
          </div>
          <div className="py-8">
            <div className="text-[28px] font-semibold leading-none">Nothing due is selected.</div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-black/70">Go back to Today and open a due item from the list.</p>
            <div className="mt-5">
              <Link href="/" className="border border-black bg-white px-3 py-2 text-sm">
                Back to Today
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#eef0f3] text-black">
      <div className="grid min-h-screen grid-rows-[50px_1fr_20px]">
        <header className="border-b border-black bg-white px-4">
          <div className="mx-auto grid h-full max-w-[1240px] grid-cols-2 items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <img src={heroMark} alt="Hero" className="h-5 w-5" />
              <span className="font-semibold">Hero</span>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs">
              <Link href="/" className="border border-black bg-white px-2 py-1">
                Today
              </Link>
              <Link href="/done" className="border border-black bg-white px-2 py-1">
                Done
              </Link>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 px-3 py-3 lg:grid-cols-[1fr_minmax(680px,830px)_220px] lg:gap-3">
          <div className="hidden lg:block" />

          <section className="border border-black bg-white">
            <div className="border-b border-black bg-black px-4 py-4 text-white">
              <div className="text-xs text-white/65">Due now</div>
              <div className="mt-2 text-[30px] font-semibold leading-tight">{item.title}</div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/75">
                <span>{formatDueLabel(item.dueAt)}</span>
                <span>{item.type === "link" ? "link" : "task"}</span>
                {project ? <span>{project.name}</span> : null}
                {item.isRecurringDaily ? <span>daily</span> : null}
              </div>
            </div>

            <div className="grid gap-5 px-4 py-4">
              <div>
                <div className="text-sm font-semibold">Break it down</div>
                <p className="mt-1 text-sm leading-6 text-black/70">If this task is too large, turn it into a smaller next step and give it a new reminder.</p>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-black/65">
                Smaller next step
                <textarea
                  value={smallerStep}
                  onChange={(event) => setSmallerStep(event.target.value)}
                  className="mt-2 min-h-[110px] w-full border border-black bg-white px-3 py-3 text-sm font-normal normal-case tracking-normal text-black outline-none"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-black/65">
                Resnooze for
                <input
                  value={resnooze}
                  onChange={(event) => setResnooze(event.target.value)}
                  placeholder="tomorrow 9am"
                  className="mt-2 w-full border border-black bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-black outline-none"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleBreakDown()} className="border border-black bg-black px-3 py-2 text-sm text-white">
                  Save smaller step
                </button>
                <button type="button" onClick={() => void handleDone()} className="border border-black bg-white px-3 py-2 text-sm">
                  Mark done
                </button>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="border border-black bg-white px-3 py-2 text-sm">
                    Open link
                  </a>
                ) : null}
              </div>

              {item.originalTitle && item.originalTitle !== item.title ? (
                <div className="border-t border-black pt-3 text-xs text-black/65">
                  Original task: <span className="text-black">{item.originalTitle}</span>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="mt-3 border border-black bg-[#e4e6ea] p-3 text-xs lg:mt-0">
            <table className="w-full">
              <tbody>
                <tr>
                  <td colSpan={2} className="pb-2 font-semibold">Actions</td>
                </tr>
                <tr>
                  <td className="py-1 text-black/75">Save smaller step</td>
                  <td className="py-1 text-right font-semibold">S</td>
                </tr>
                <tr>
                  <td className="py-1 text-black/75">Mark done</td>
                  <td className="py-1 text-right font-semibold">D</td>
                </tr>
                <tr>
                  <td className="py-1 text-black/75">Back to today</td>
                  <td className="py-1 text-right font-semibold">Esc</td>
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
