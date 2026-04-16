/*
Design note for this file:
- Analytics should feel like a quiet ledger, not a separate product.
- Keep the same thin-border, monochrome logic as Today so the reporting view remains part of the same ritual.
- Show only one useful story first: how many tasks were finished per day.
*/
import { useMemo } from "react";
import { useLocation } from "wouter";
import { getLocalDayKey, useHeroApp } from "@/hooks/useHeroApp";

const heroLogo =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-128_efe10397.png";

function formatDayLabel(input: string) {
  const [year, month, day] = input.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(year, month - 1, day));
}

function formatTotalLabel(total: number) {
  return `${total} task${total === 1 ? "" : "s"}`;
}

export default function Analytics() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();

  const doneByDay = useMemo(() => {
    const counts = new Map<string, number>();

    hero.doneItems.forEach((item) => {
      const key = getLocalDayKey(item.completedAt || item.updatedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-21)
      .map(([date, count]) => ({ date, count }));
  }, [hero.doneItems]);

  const maxCount = doneByDay.reduce((largest, row) => Math.max(largest, row.count), 1);
  const totalDone = hero.doneItems.length;

  if (!hero.authChecked) {
    return <main className="min-h-screen bg-[#f6f6f3]" />;
  }

  if (!hero.user) {
    return (
      <main className="min-h-screen bg-[#f6f6f3] px-4 py-8 text-black">
        <div className="mx-auto max-w-3xl border border-black bg-white p-5">
          <div className="text-sm">Sign in from Today to see your completion history.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f6f3] px-3 py-3 text-black sm:px-4">
      <div className="mx-auto max-w-5xl border border-black bg-white shadow-[10px_10px_0_rgba(0,0,0,0.05)]">
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
              <span className="text-black">Analytics</span>
              <button type="button" onClick={() => navigate("/done")} className="hover:text-black">
                Done
              </button>
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap gap-6 text-sm text-black/72">
            <div>
              <div className="text-[24px] font-semibold leading-none text-black">Daily completions</div>
              <div className="mt-1 text-xs uppercase tracking-[0.14em] text-black/48">Last 21 active days</div>
            </div>
            <div className="text-xs uppercase tracking-[0.14em] text-black/48">
              <div>{formatTotalLabel(totalDone)} archived</div>
              <div className="mt-1">{hero.doneTodayCount} done today</div>
            </div>
          </div>
        </header>

        <section className="px-3 py-4 sm:px-4">
          {doneByDay.length ? (
            <div className="space-y-3">
              {doneByDay.map((row) => (
                <article key={row.date} className="grid grid-cols-[92px_minmax(0,1fr)_70px] items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)_80px]">
                  <div className="text-xs text-black/62">{formatDayLabel(row.date)}</div>
                  <div className="h-6 border border-black bg-[#f0f0ed]">
                    <div className="h-full bg-black" style={{ width: `${Math.max((row.count / maxCount) * 100, 8)}%` }} />
                  </div>
                  <div className="text-right text-xs font-semibold text-black">{row.count}</div>
                </article>
              ))}
            </div>
          ) : (
            <div className="text-sm leading-7 text-black/62">Nothing completed yet. As tasks are marked done, the daily history will appear here.</div>
          )}
        </section>
      </div>
    </main>
  );
}
