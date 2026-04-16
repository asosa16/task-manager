/*
Design note for this file:
- The due screen should feel like a single clear intervention, not a second product.
- Preserve the core decision: finish the task now, or turn it into a smaller next step and wake it up later.
*/
import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { formatDueLabel, useHeroApp } from "@/hooks/useHeroApp";

const heroLogo =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-128_efe10397.png";

function isEditingField(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(element?.isContentEditable);
}

export default function Due() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();
  const [matched, params] = useRoute("/due/:id");
  const [smallerStep, setSmallerStep] = useState("");
  const [wakeUpLater, setWakeUpLater] = useState("tomorrow 9am");

  const item = useMemo(() => {
    const routeId = matched && params ? params.id : null;
    if (routeId) return hero.items.find((entry) => entry.id === routeId) ?? null;
    return hero.selectedItem;
  }, [hero.items, hero.selectedItem, matched, params]);

  useEffect(() => {
    if (!item) return;
    setSmallerStep(item.title);
    hero.setSelectedId(item.id);
  }, [hero, item]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!item) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const active = document.activeElement;
        if (active instanceof HTMLElement && isEditingField(active)) {
          active.blur();
          return;
        }
        navigate("/");
        return;
      }
      if (isEditingField(event.target)) return;
      if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        void handleDone();
        return;
      }
      if (event.key === "s" || event.key === "S" || event.key === "Enter") {
        event.preventDefault();
        void handleBreakDown();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, smallerStep, wakeUpLater]);

  async function handleDone() {
    if (!item) return;
    const result = await hero.markDone(item.id);
    if (!result.ok) return toast.error(result.message);
    toast.success(`${result.message} Press Z to undo.`);
    navigate("/done");
  }

  async function handleBreakDown() {
    if (!item) return;
    const result = await hero.breakDownAndResnooze(item.id, smallerStep, wakeUpLater);
    if (!result.ok) return toast.error(result.message);
    toast.success(`${result.message} Press Z to undo.`);
    navigate("/");
  }

  if (!hero.authChecked) {
    return <main className="min-h-screen bg-[#f6f6f3]" />;
  }

  if (!item) {
    return (
      <main className="min-h-screen bg-[#f6f6f3] px-3 py-3 text-black sm:px-4">
        <div className="mx-auto max-w-3xl border border-black bg-white p-5 shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
          <div className="text-sm">No due task is selected right now. Go back to Today and choose one item.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f6f3] px-3 py-3 text-black sm:px-4">
      <div className="mx-auto max-w-3xl border border-black bg-white shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
        <header className="border-b border-black px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm font-semibold">
              <img src={heroLogo} alt="Hero logo" className="h-8 w-8 rounded-[12px]" />
              <span className="text-[15px] uppercase tracking-[0.18em]">Hero</span>
            </div>
            <nav className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-black/58">
              <button type="button" onClick={() => navigate("/")} className="hover:text-black">
                Today
              </button>
              <button type="button" onClick={() => navigate("/all")} className="hover:text-black">
                All
              </button>
              <button type="button" onClick={() => navigate("/analytics")} className="hover:text-black">
                Analytics
              </button>
              <button type="button" onClick={() => navigate("/done")} className="hover:text-black">
                Done
              </button>
            </nav>
          </div>
          <div className="mt-4 text-xs uppercase tracking-[0.14em] text-black/48">{formatDueLabel(item.dueAt).replace(" · ", " at ")}</div>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight">{item.title}</h1>
        </header>

        <section className="space-y-4 px-3 py-4 sm:px-4">
          <div className="space-y-2 text-sm leading-6 text-black/68">
            <p>Either finish this now, or turn it into a smaller step and give it a new wake-up time.</p>
          </div>

          <label className="block text-[11px] uppercase tracking-[0.14em] text-black/48">
            Smaller next step
            <textarea
              value={smallerStep}
              onChange={(event) => setSmallerStep(event.target.value)}
              className="mt-2 min-h-[120px] w-full border border-black px-3 py-3 text-sm normal-case tracking-normal text-black outline-none"
            />
          </label>

          <label className="block text-[11px] uppercase tracking-[0.14em] text-black/48">
            Wake up later
            <input
              value={wakeUpLater}
              onChange={(event) => setWakeUpLater(event.target.value)}
              className="mt-2 min-h-11 w-full border border-black px-3 text-sm normal-case tracking-normal text-black outline-none"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleBreakDown()} className="inline-flex min-h-11 items-center border border-black bg-black px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white">
              Save smaller step
            </button>
            <button type="button" onClick={() => void handleDone()} className="inline-flex min-h-11 items-center border border-black px-4 text-xs font-semibold uppercase tracking-[0.14em] text-black">
              Mark done
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
