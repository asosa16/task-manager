/*
Design note for this file:
- The done view should feel like the extension's quiet archive, not a celebratory dashboard.
- Keep the same stripped shell as Today: thin borders, compact rows, modest typography, and almost no ornament.
- Make keyboard navigation clear and reversible, with Today only one keystroke away.
*/
import { useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { formatDueLabel, useHeroApp } from "@/hooks/useHeroApp";

const heroMark =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-icon_f01a2065.png";

function isEditingField(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(element?.isContentEditable);
}

export default function Done() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();

  const projectMap = useMemo(
    () => new Map(hero.projects.map((project) => [project.id, project.name])),
    [hero.projects],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditingField(event.target)) return;
      if (event.key === "Tab") {
        event.preventDefault();
        navigate("/");
        return;
      }
      if (event.key === "z" || event.key === "Z") {
        event.preventDefault();
        void hero.undoLastAction().then((result) => {
          if (!result.ok) return toast.error(result.message);
          toast.success(result.message);
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hero, navigate]);

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
              <button type="button" onClick={() => void hero.signOut()} className="border border-black bg-white px-2 py-1">
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 px-3 py-3 lg:grid-cols-[1fr_minmax(680px,830px)_220px] lg:gap-3">
          <div className="hidden lg:block" />

          <section className="border border-black bg-white">
            <div className="border-b border-black px-4 py-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[28px] font-semibold leading-none">Done</div>
                  <div className="mt-1 text-xs text-black/70">{hero.doneItems.length} archived · {hero.doneTodayCount} done today · {hero.streak} day streak</div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Link href="/" className="text-black/70 hover:text-black">
                    Upcoming
                  </Link>
                  <span className="border-b border-black pb-[2px] font-semibold">Done</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto px-4 py-4">
              <table className="w-full border-collapse text-sm">
                <colgroup>
                  <col className="w-[170px]" />
                  <col />
                  <col className="w-[130px]" />
                </colgroup>
                <tbody>
                  {hero.doneItems.map((item) => (
                    <tr key={item.id} className="bg-white hover:bg-[#f5f6f8]">
                      <td className="border-b border-black/15 px-2 py-2 align-top text-xs text-black/70">
                        {formatDueLabel(item.completedAt || item.updatedAt)}
                      </td>
                      <td className="border-b border-black/15 px-2 py-2 align-top">
                        <div className="flex items-start gap-2">
                          <span className="mt-[2px] inline-block h-2 w-2 border border-black bg-black" />
                          <div>
                            <div className="leading-5 text-black">{item.title}</div>
                            <div className="mt-1 text-xs text-black/45">
                              {item.type === "link" ? "link" : "task"}
                              {item.url ? (
                                <a href={item.url} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-2">
                                  open
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-black/15 px-2 py-2 align-top text-xs text-black/65">
                        {item.projectId ? projectMap.get(item.projectId) ?? "—" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {hero.doneItems.length === 0 ? <div className="py-8 text-sm text-black/65">Nothing archived yet. Clear a few items from Today and they will appear here.</div> : null}
            </div>
          </section>

          <aside className="mt-3 border border-black bg-[#e4e6ea] p-3 text-xs lg:mt-0">
            <table className="w-full">
              <tbody>
                <tr>
                  <td colSpan={2} className="pb-2 font-semibold">Archive</td>
                </tr>
                <tr>
                  <td className="py-1 text-black/75">Return to today</td>
                  <td className="py-1 text-right font-semibold">Tab</td>
                </tr>
                <tr>
                  <td className="py-1 text-black/75">Undo last change</td>
                  <td className="py-1 text-right font-semibold">Z</td>
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
