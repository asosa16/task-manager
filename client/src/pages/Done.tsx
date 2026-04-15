/*
Design note for this file:
- The Done view should feel rewarding but not celebratory in a loud way.
- Treat completed work like neatly archived slips with quiet momentum metrics.
- Keep the interface reflective, warm, and structured like a personal dashboard rather than a chart-heavy analytics tool.
*/
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { formatDueLabel, useHeroApp, toneClassMap } from "@/hooks/useHeroApp";
import { cn } from "@/lib/utils";

const heroTexture =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-paper-texture-wide_1a663de6.png";
const projectTagsScene =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663183942827/auuJbr6QdBfQAgc8r4WcfX/hero-project-tags_aac25abe.png";

export default function Done() {
  const hero = useHeroApp();
  const latestFive = hero.doneItems.slice(0, 5);

  return (
    <main className="hero-done-shell" style={{ backgroundImage: `linear-gradient(180deg, rgba(248,243,235,0.94), rgba(243,236,224,0.92)), url(${heroTexture})` }}>
      <section className="hero-done-layout">
        <header className="hero-done-header">
          <div>
            <p className="hero-eyebrow">Done archive</p>
            <h1>Quiet evidence that you are moving.</h1>
          </div>
          <div className="hero-header-actions">
            <Link href="/" className="hero-inline-link">
              Back to upcoming
            </Link>
            <Button variant="outline" className="hero-outline-button" onClick={() => hero.signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        <section className="hero-done-metrics-grid">
          <article className="hero-metric-card">
            <p className="hero-eyebrow">Done today</p>
            <h2>{hero.doneTodayCount}</h2>
            <p>Enough movement to keep the queue honest.</p>
          </article>
          <article className="hero-metric-card">
            <p className="hero-eyebrow">Current streak</p>
            <h2>{hero.streak}</h2>
            <p>Consecutive days with visible completions.</p>
          </article>
          <article className="hero-metric-card hero-metric-card--visual">
            <img src={projectTagsScene} alt="Project labels arranged on a desk" />
          </article>
        </section>

        <section className="hero-done-grid">
          <article className="hero-done-panel">
            <div className="hero-section-heading-row">
              <div>
                <p className="hero-eyebrow">Recent completions</p>
                <h3>{hero.doneItems.length} items archived</h3>
              </div>
            </div>
            <div className="hero-done-list">
              {hero.doneItems.length ? (
                hero.doneItems.map((item) => {
                  const project = hero.projects.find((entry) => entry.id === item.projectId);
                  return (
                    <article key={item.id} className="hero-done-item">
                      <div>
                        <p className="hero-item-kind">{item.type === "task" ? "Task" : "Saved link"}</p>
                        <h4>{item.title}</h4>
                        <p className="hero-fine-print">Completed {item.completedAt ? formatDueLabel(item.completedAt) : formatDueLabel(item.updatedAt)}</p>
                      </div>
                      {project ? <span className={cn("hero-tag", toneClassMap[project.tone])}>{project.name}</span> : null}
                    </article>
                  );
                })
              ) : (
                <div className="hero-empty-copy">
                  <p className="hero-eyebrow">Nothing archived yet</p>
                  <h3>Your done list will start filling the moment you clear your first item.</h3>
                </div>
              )}
            </div>
          </article>

          <article className="hero-done-panel">
            <div className="hero-section-heading-row">
              <div>
                <p className="hero-eyebrow">Latest rhythm</p>
                <h3>Last five actions</h3>
              </div>
            </div>
            <div className="hero-rhythm-list">
              {latestFive.length ? (
                latestFive.map((item, index) => (
                  <div key={item.id} className="hero-rhythm-row">
                    <span className="hero-rhythm-index">0{index + 1}</span>
                    <div>
                      <p>{item.title}</p>
                      <span>{item.completedAt ? formatDueLabel(item.completedAt) : formatDueLabel(item.updatedAt)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="hero-fine-print">The rhythm view wakes up once you complete a few tasks.</p>
              )}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
