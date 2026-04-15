/*
Design note for this file:
- The done view should feel like the extension's quiet archive, not a celebratory dashboard.
- Keep the same stripped shell as Today: thin borders, compact rows, modest typography, and almost no ornament.
- Mobile usability must match desktop usability, so the archive becomes a stacked list first and only uses a side rail on large screens.
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

function ArchiveRail({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={mobile ? "text-xs" : "border border-black bg-[#e4e6ea] p-3 text-xs"}>
      <table className="w-full">
        <tbody>
          <tr>
            <td colSpan={2} className="pb-2 font-semibold">
              Archive
            </td>
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
    </div>
  );
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
      <header className="sticky top-0 z-20 border-b border-black bg-white px-3 sm:px-4">
        <div className="mx-auto flex min-h-[52px] max-w-[1120px] items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <img src={heroMark} alt="Hero" className="h-5 w-5" />
            <span className="font-semibold">Hero</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link href="/" className="border border-black bg-white px-3 py-2">
              Today
            </Link>
            <button type="button" onClick={() => void hero.signOut()} className="border border-black bg-white px-3 py-2">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1120px] gap-3 px-3 py-3 xl:grid-cols-[minmax(0,1fr)_220px] sm:px-4 sm:py-4">
        <section className="border border-black bg-white">
          <div className="border-b border-black px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[28px] font-semibold leading-none">Done</div>
                <div className="mt-1 text-xs leading-5 text-black/70">
                  {hero.doneItems.length} archived · {hero.doneTodayCount} done today · {hero.streak} day streak
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Link href="/" className="text-black/70 hover:text-black">
                  Upcoming
                </Link>
                <span className="border-b border-black pb-[2px] font-semibold">Done</span>
              </div>
            </div>
          </div>

          <div className="divide-y divide-black/15">
            {hero.doneItems.map((item) => {
              const projectName = item.projectId ? projectMap.get(item.projectId) ?? "—" : "—";

              return (
                <article key={item.id} className="bg-white px-4 py-3 hover:bg-[#f5f6f8]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-black/65">
                        <span>{formatDueLabel(item.completedAt || item.updatedAt)}</span>
                        {projectName !== "—" ? <span>{projectName}</span> : null}
                        <span>{item.type === "link" ? "link" : "task"}</span>
                      </div>
                      <div className="mt-1 flex items-start gap-2">
                        <span className="mt-[6px] inline-block h-2.5 w-2.5 shrink-0 border border-black bg-black" />
                        <div className="min-w-0">
                          <div className="break-words text-sm leading-5 text-black sm:text-[15px]">{item.title}</div>
                          {item.url ? (
                            <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline underline-offset-2">
                              Open link
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}

            {hero.doneItems.length === 0 ? (
              <div className="px-4 py-10 text-sm leading-6 text-black/65">
                Nothing archived yet. Clear a few items from Today and they will appear here.
              </div>
            ) : null}
          </div>

          <details className="border-t border-black bg-[#e4e6ea] xl:hidden">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">Shortcuts & actions</summary>
            <div className="px-4 pb-4">
              <ArchiveRail mobile />
            </div>
          </details>
        </section>

        <aside className="hidden xl:block">
          <ArchiveRail />
        </aside>
      </div>
    </main>
  );
}
