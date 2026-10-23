import Link from "next/link";
import { notFound } from "next/navigation";
import { CCSS_NOTICE, Lesson, officialUrl } from "@nl/schema";
import { AppShell } from "@/components/AppShell";
import { collabToken, getLesson } from "@/lib/lessons";
import { requireUser } from "@/lib/session";
import { Editor } from "./Editor";
import { ApprovalPanel, ChecksPanel } from "./Panels";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  pending: ["Not generated", "badge-neutral"],
  generating: ["Generating", "badge-info"],
  flagged: ["Flagged", "badge-warning"],
  in_review: ["In review", "badge-info"],
  approved: ["Approved", "badge-ok"],
};

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const user = await requireUser();
  const data = await getLesson(lessonId);
  if (!data) notFound();
  const { lesson, row, unit, version, approval, approverName } = data;

  const draft = Lesson.safeParse(version?.content);
  const editable = !!version && draft.success;
  const token = editable ? await collabToken(user, lesson) : null;
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL || "ws://localhost:1234";
  const [statusLabel, statusClass] = STATUS[lesson.status] ?? ["", "badge-neutral"];
  const isApprover = user.role === "approver" || user.role === "admin";
  const alignment = draft.success ? draft.data.sections.flatMap((s) => s.parts.filter((p) => p.standards.length).map((p) => ({ title: p.title, codes: p.standards }))) : [];

  return (
    <AppShell user={user} current="units">
      <main className="page page-wide">
        <div className="page-head">
          <div>
            <div className="eyebrow">
              <Link href={`/units/${unit.id}/review`}>
                Grade {unit.grade ?? "?"} · Unit {unit.unitNumber ?? "?"}
              </Link>{" "}
              · Lesson {row.lessonNumber} · {row.lessonType}
            </div>
            <h1>
              Lesson {row.lessonNumber} <span className={`badge ${statusClass}`}>{statusLabel}</span>
            </h1>
          </div>
          <Link className="btn" href={`/units/${unit.id}/review`}>
            All lessons
          </Link>
        </div>

        <div className="lesson-layout">
          <article className="card lesson-main" aria-label="Lesson document">
            {token ? (
              <Editor
                url={collabUrl}
                room={lesson.collabRoom}
                token={token}
                user={{ id: user.id, name: user.name }}
                readOnlyNote={lesson.status === "approved" ? "This lesson is approved. Any edit sends it back to review and is logged." : undefined}
              />
            ) : (
              <p className="card-pad muted">{version ? "The generated draft does not match the lesson format. Regenerate it from the generation page." : "This lesson has not been generated yet."}</p>
            )}
          </article>

          <aside className="lesson-side" aria-label="Review panel">
            <ChecksPanel lessonId={lesson.id} initial={version?.validation ?? []} />

            <section className="card card-pad side" aria-labelledby="approval">
              <h2 id="approval">Approval</h2>
              {approval ? (
                <dl className="kv">
                  <dt>Approved by</dt>
                  <dd>{approverName}</dd>
                  <dt>When</dt>
                  <dd>{approval.approvedAt.toLocaleString("en-US")}</dd>
                  <dt>Content hash</dt>
                  <dd className="mono">sha256 · {approval.contentHash.slice(0, 8)}…{approval.contentHash.slice(-4)}</dd>
                </dl>
              ) : (
                <p className="muted">{isApprover ? "Approving saves a frozen copy of the lesson as it is now." : "An approver signs off once review is done."}</p>
              )}
              {editable && (
                <ApprovalPanel
                  lessonId={lesson.id}
                  approved={lesson.status === "approved"}
                  canApprove={isApprover && lesson.status !== "flagged"}
                  canSendBack={(isApprover || user.role === "reviewer") && lesson.status === "approved"}
                />
              )}
            </section>

            <section className="card card-pad side" aria-labelledby="align">
              <h2 id="align">Standards alignment</h2>
              {alignment.length ? (
                <ul className="align-list">
                  {alignment.map((a, i) => (
                    <li key={i}>
                      <span>{a.title}</span>
                      <span>
                        {a.codes.map((c) => {
                          const href = officialUrl(c);
                          return href ? (
                            <a key={c} href={href} target="_blank" rel="noreferrer">
                              {c}{" "}
                            </a>
                          ) : (
                            <span key={c}>{c} </span>
                          );
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No parts are mapped to standards yet.</p>
              )}
              <p className="muted small">Codes link to the official text. Standards are never paraphrased. {CCSS_NOTICE}</p>
            </section>

            <section className="card card-pad side" aria-labelledby="prov">
              <h2 id="prov">Provenance</h2>
              <dl className="kv">
                <dt>Outline row</dt>
                <dd>Lesson {row.lessonNumber}</dd>
                <dt>Model</dt>
                <dd>{version?.modelId ?? "None"}</dd>
                <dt>Generated</dt>
                <dd>{version ? version.createdAt.toLocaleString("en-US") : "Not yet"}</dd>
                <dt>Edited by people</dt>
                <dd>{lesson.collabState ? "Yes" : "No"}</dd>
              </dl>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
