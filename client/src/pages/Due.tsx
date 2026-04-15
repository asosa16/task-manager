/*
Design note for this file:
- This page carries the most opinionated legacy Hero behavior.
- It should feel focused, warm, and slightly urgent: one task, one decision, one smaller next step.
- The visual language should resemble a highlighted task slip placed on a desk under direct light.
*/
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHeroApp, formatDueLabel } from "@/hooks/useHeroApp";

const heroTexture =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-paper-texture-wide_1a663de6.png";
const mobileScene =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-mobile-planner_5e89fa5c.png";

export default function Due() {
  const hero = useHeroApp();
  const [, navigate] = useLocation();
  const [matched, params] = useRoute<{ id: string }>("/due/:id");
  const item = useMemo(() => hero.items.find((entry) => entry.id === params?.id), [hero.items, params?.id]);
  const [smallerStep, setSmallerStep] = useState("");
  const [dueInput, setDueInput] = useState("tomorrow 9am");

  useEffect(() => {
    if (item) {
      setSmallerStep(item.title);
      setDueInput("tomorrow 9am");
    }
  }, [item]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!item) return;
      if (event.altKey && (event.key === "d" || event.key === "D")) {
        event.preventDefault();
        hero.markDone(item.id);
        toast.success("Task marked done.");
        navigate("/");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hero, item, navigate]);

  if (!matched || !item) {
    return (
      <main className="hero-due-shell" style={{ backgroundImage: `linear-gradient(180deg, rgba(248,243,235,0.94), rgba(243,236,224,0.92)), url(${heroTexture})` }}>
        <section className="hero-due-empty">
          <img src={mobileScene} alt="Mobile planner illustration" />
          <p className="hero-eyebrow">No due item found</p>
          <h1>This task slip has already moved.</h1>
          <Link href="/" className="hero-inline-link">
            Return to the queue
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="hero-due-shell" style={{ backgroundImage: `linear-gradient(180deg, rgba(248,243,235,0.94), rgba(243,236,224,0.92)), url(${heroTexture})` }}>
      <section className="hero-due-panel">
        <div className="hero-due-header">
          <div>
            <p className="hero-eyebrow">Task due now</p>
            <h1>{item.title}</h1>
          </div>
          <Link href="/" className="hero-inline-link">
            Back to upcoming
          </Link>
        </div>

        <div className="hero-due-meta">
          <span className="hero-chip hero-chip--alert">Due now</span>
          <span className="hero-chip hero-chip--muted">Originally {formatDueLabel(item.dueAt)}</span>
          {item.originalTitle && item.originalTitle !== item.title ? (
            <span className="hero-chip hero-chip--muted">From: {item.originalTitle}</span>
          ) : null}
        </div>

        <div className="hero-due-grid">
          <article className="hero-due-card-surface">
            <p className="hero-eyebrow">What woke up</p>
            <div className="hero-task-slip">
              <span className="hero-task-slip-label">Current task</span>
              <h2>{item.title}</h2>
              <p>
                The original extension pushed due tasks into a dedicated screen so you had to make a
                choice. The web version keeps that ritual intact.
              </p>
            </div>
          </article>

          <article className="hero-due-card-surface">
            <p className="hero-eyebrow">Break it down</p>
            <label className="hero-field">
              <span>Smaller next step</span>
              <input value={smallerStep} onChange={(event) => setSmallerStep(event.target.value)} placeholder="Email Ana for the missing attachment" />
            </label>
            <label className="hero-field">
              <span>Wake me again</span>
              <input value={dueInput} onChange={(event) => setDueInput(event.target.value)} placeholder="today 4pm" />
            </label>
            <p className="hero-fine-print">{hero.formatPreviewFromInput(dueInput)}</p>
            <div className="hero-due-actions">
              <Button
                className="hero-primary-button"
                onClick={() => {
                  const result = hero.breakDownAndResnooze(item.id, smallerStep, dueInput);
                  if (!result.ok) {
                    toast.error(result.message);
                    return;
                  }
                  toast.success(result.message);
                  navigate("/");
                }}
              >
                Save smaller step
              </Button>
              <Button
                variant="outline"
                className="hero-outline-button"
                onClick={() => {
                  const result = hero.rescheduleItem(item.id, dueInput);
                  if (!result.ok) {
                    toast.error(result.message);
                    return;
                  }
                  toast.success(result.message);
                  navigate("/");
                }}
              >
                Just reschedule
              </Button>
              <Button
                variant="outline"
                className="hero-outline-button"
                onClick={() => {
                  hero.markDone(item.id);
                  toast.success("Task marked done.");
                  navigate("/");
                }}
              >
                Mark done
              </Button>
            </div>
          </article>
        </div>

        <div className="hero-due-footer-note">
          <p>
            Shortcut preserved from the extension: press <strong>Alt + D</strong> to mark this task done.
          </p>
        </div>
      </section>
    </main>
  );
}
