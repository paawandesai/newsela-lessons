import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getGenerationStatus, type LessonStatusRow } from "@/lib/generation";
import { requireUser } from "@/lib/session";
import { AutoRefresh, CancelButton, RegenerateButton, StartButton } from "./Controls";

export const dynamic = "force-dynamic";

const RUN_LABEL = {
  running: "Running",
  completed: "Finished",
  stopped_at_cap: "Stopped at the spend cap",
  cancelled: "Stopped",
} as const;

function statusBadge(l: LessonStatusRow): [string, string] {
  if (l.status === "approved") return ["Approved", "badge-ok"];
  if (l.status === "in_review") return ["Ready for review", "badge-ok"];
  if (l.status === "flagged") return [l.job?.status === "failed" ? "Failed" : "Flagged", "badge-warning"];
  if (l.status === "generating") return ["Generating", "badge-info"];
  if (l.job?.status === "queued") return ["Queued", "badge-neutral"];
  if (l.job?.status === "skipped") return ["Not run", "badge-neutral"];
  return ["Not started", "badge-neutral"];
}

function checks(l: LessonStatusRow) {
  if (l.job?.status === "failed") return { text: l.job.error ?? "Generation failed.", tone: "var(--warn)" };
  if (l.job?.status === "skipped" && !l.flags.length) return { text: l.job.error ?? "Skipped.", tone: undefined };
  if (l.status === "generating") return { text: `Attempt ${Math.max(1, l.job?.attempts ?? 1)}`, tone: undefined };
  const errors = l.flags.filter((f) => f.severity === "error");
  const warnings = l.flags.filter((f) => f.severity === "warning");
  if (errors.length) return { text: errors[0]!.message + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ""), tone: "var(--warn)" };
  if (warnings.length) return { text: `${warnings.length} warning${warnings.length > 1 ? "s" : ""}: ${warnings[0]!.message}`, tone: undefined };
  if (l.status === "in_review" || l.status === "approved") return { text: "All passed", tone: undefined };
  return { text: "", tone: undefined };
}

export default async function GeneratePage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  const user = await requireUser();
  const data = await getGenerationStatus(unitId);
  if (!data) notFound();
  const { unit, run, prompt, runSpend, lessons } = data;

  const total = lessons.length;
  const done = lessons.filter((l) => ["in_review", "approved", "flagged"].includes(l.status)).length;
  const flagged = lessons.filter((l) => l.status === "flagged").length;
  const running = run?.status === "running";
  const active = running || lessons.some((l) => l.status === "generating");
  const pct = total ? Math.round((done / total) * 100) : 0;
  const canRun = user.role === "expert" || user.role === "admin";
  const canRegenerate = canRun || user.role === "reviewer";
  const remaining = lessons.filter((l) => l.status === "pending").length;

  return (
    <AppShell user={user} current="units">
      <AutoRefresh active={active} />
      <main className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">
              Grade {unit.grade ?? "?"} · Unit {unit.unitNumber ?? "?"}
              {run && ` · ${RUN_LABEL[run.status]}, started ${run.createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
            </div>
            <h1>{running ? `Generating ${total} lessons` : "Generate lessons"}</h1>
          </div>
          <div className="row">
            {canRun && running && run && <CancelButton unitId={unit.id} runId={run.id} />}
            {canRun && !running && unit.status !== "needs_review" && remaining > 0 && (
              <StartButton unitId={unit.id} label={run ? `Generate ${remaining} remaining` : `Generate ${total} lessons`} />
            )}
            <Link className="btn" href={`/units/${unit.id}`}>
              Outline
            </Link>
          </div>
        </div>

        {unit.status === "needs_review" && (
          <div className="alert alert-error" role="status">
            Confirm the outline before generating. <Link href={`/units/${unit.id}`}>Go to the outline checks</Link>
          </div>
        )}

        <section className="stats" aria-label="Run summary">
          <div className="card card-pad">
            <div className="muted">Done</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {done} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>of {total}</span>
            </div>
            <div role="img" aria-label={`${pct} percent complete`} style={{ marginTop: 8, height: 8, borderRadius: 4, background: "#eaeef2", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: 8, background: "var(--accent)" }} />
            </div>
          </div>
          <div className="card card-pad">
            <div className="muted">Flagged for a closer look</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: flagged ? "var(--warn)" : undefined }}>{flagged}</div>
            <div className="muted">Failed a check or the call failed</div>
          </div>
          <div className="card card-pad">
            <div className="muted">Spend this run</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              ${runSpend.toFixed(2)}{" "}
              {run && (
                <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>
                  of ${Number(run.capUsd).toFixed(0)} cap
                </span>
              )}
            </div>
            <div className="muted">Stops at the cap</div>
          </div>
          <div className="card card-pad">
            <div className="muted">Prompt and model</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Prompt v{prompt?.version ?? "?"}</div>
            <div className="muted">{run?.modelId ?? process.env.GENERATION_MODEL ?? "claude-opus-5-5"}</div>
          </div>
        </section>

        <section className="card" aria-labelledby="jobs">
          <div className="card-head">
            <h2 id="jobs">Lessons</h2>
            {active && <span className="muted">Updates every few seconds</span>}
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Lesson</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Checks</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Cost
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((l) => {
                  const [label, cls] = statusBadge(l);
                  const c = checks(l);
                  const hasOutput = ["in_review", "approved"].includes(l.status) || (l.status === "flagged" && l.flags.length > 0);
                  return (
                    <tr key={l.lessonId}>
                      <td>
                        {hasOutput ? (
                          <Link href={`/lessons/${l.lessonId}`} style={{ fontWeight: 600 }}>
                            L{l.lessonNumber}
                          </Link>
                        ) : (
                          <span style={{ fontWeight: 600 }}>L{l.lessonNumber}</span>
                        )}{" "}
                        <span className="muted">· {l.summary}</span>
                      </td>
                      <td>{l.lessonType}</td>
                      <td>
                        <span className={`badge ${cls}`}>{label}</span>
                      </td>
                      <td style={{ color: c.tone }}>{c.text}</td>
                      <td style={{ textAlign: "right" }} className={l.job?.costUsd ? undefined : "muted"}>
                        {l.job?.costUsd ? `$${Number(l.job.costUsd).toFixed(2)}` : "–"}
                      </td>
                      <td>
                        {canRegenerate && !l.edited && ["flagged", "in_review"].includes(l.status) && (
                          <RegenerateButton unitId={unit.id} lessonId={l.lessonId} lessonNumber={l.lessonNumber} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
