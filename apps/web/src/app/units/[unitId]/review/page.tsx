import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getGenerationStatus } from "@/lib/generation";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["all", "All"],
  ["flagged", "Flagged"],
  ["in_review", "In review"],
  ["approved", "Approved"],
  ["pending", "Not generated"],
] as const;

const BADGE: Record<string, [string, string]> = {
  pending: ["Not generated", "badge-neutral"],
  generating: ["Generating", "badge-info"],
  flagged: ["Flagged", "badge-warning"],
  in_review: ["In review", "badge-info"],
  approved: ["Approved", "badge-ok"],
};

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ unitId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { unitId } = await params;
  const { status = "all" } = await searchParams;
  const user = await requireUser();
  const data = await getGenerationStatus(unitId);
  if (!data) notFound();
  const { unit, lessons } = data;

  const count = (s: string) => (s === "all" ? lessons.length : lessons.filter((l) => l.status === s).length);
  const shown = status === "all" ? lessons : lessons.filter((l) => l.status === status);
  const total = lessons.length || 1;
  const pct = (s: string) => `${(count(s) / total) * 100}%`;

  return (
    <AppShell user={user} current="units">
      <main className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">
              Grade {unit.grade ?? "?"} · Unit {unit.unitNumber ?? "?"}
            </div>
            <h1>Review and approve</h1>
          </div>
          <div className="row">
            <Link className="btn" href={`/units/${unit.id}/generate`}>
              Generation
            </Link>
            <a className="btn" href={`/api/units/${unit.id}/export?format=html`}>
              Export approved (HTML)
            </a>
            <a className="btn" href={`/api/units/${unit.id}/export?format=json`}>
              Export approved (JSON)
            </a>
          </div>
        </div>

        <section className="card card-pad" aria-label="Approval progress">
          <div className="row" style={{ gap: "8px 24px", marginBottom: 10 }}>
            <span>
              <strong>{count("approved")}</strong> approved
            </span>
            <span>
              <strong>{count("in_review")}</strong> in review
            </span>
            <span>
              <strong>{count("flagged")}</strong> flagged
            </span>
            <span>
              <strong>{count("pending") + count("generating")}</strong> not generated
            </span>
          </div>
          <div
            role="img"
            aria-label={`${count("approved")} of ${lessons.length} approved, ${count("in_review")} in review, ${count("flagged")} flagged`}
            style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "#eaeef2" }}
          >
            <div style={{ width: pct("approved"), background: "var(--ok)" }} />
            <div style={{ width: pct("in_review"), background: "var(--accent)" }} />
            <div style={{ width: pct("flagged"), background: "#d9822b" }} />
          </div>
        </section>

        <section className="card" aria-labelledby="lessons">
          <div className="card-head">
            <h2 id="lessons">Lessons</h2>
            <nav aria-label="Filter" className="row" style={{ marginLeft: "auto", gap: 6 }}>
              {FILTERS.map(([key, label]) => (
                <Link
                  key={key}
                  href={key === "all" ? `/units/${unit.id}/review` : `/units/${unit.id}/review?status=${key}`}
                  aria-current={status === key ? "page" : undefined}
                  className={`chip${status === key ? " chip-on" : ""}`}
                >
                  {label} {count(key)}
                </Link>
              ))}
            </nav>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Lesson</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Open items</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const [label, cls] = BADGE[l.status] ?? ["", "badge-neutral"];
                  const errors = l.flags.filter((f) => f.severity === "error").length;
                  const warnings = l.flags.filter((f) => f.severity === "warning").length;
                  const open = [errors && `${errors} to fix`, warnings && `${warnings} to check`].filter(Boolean).join(", ");
                  return (
                    <tr key={l.lessonId}>
                      <td>
                        {l.status === "pending" || l.status === "generating" ? (
                          <span style={{ fontWeight: 600 }}>L{l.lessonNumber}</span>
                        ) : (
                          <Link href={`/lessons/${l.lessonId}`} style={{ fontWeight: 600 }}>
                            L{l.lessonNumber}
                          </Link>
                        )}{" "}
                        <span className="muted">· {l.summary}</span>
                      </td>
                      <td>{l.lessonType}</td>
                      <td>
                        <span className={`badge ${cls}`}>{label}</span>
                        {l.edited && <span className="muted"> · edited</span>}
                      </td>
                      <td className={open ? undefined : "muted"} style={errors ? { color: "var(--warn)" } : undefined}>
                        {l.status === "approved" ? "None" : open || (l.status === "in_review" ? "None" : "")}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No lessons in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
