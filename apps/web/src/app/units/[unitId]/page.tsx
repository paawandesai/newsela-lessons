import Link from "next/link";
import { notFound } from "next/navigation";
import type { Flag } from "@nl/db";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/session";
import { getUnitWithRows, unresolvedErrors } from "@/lib/units";
import { confirmOutline, resolveFlagAction } from "../actions";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;
const SEVERITY_LABEL = { error: ["Decide", "badge-error"], warning: ["Warning", "badge-warning"], info: ["Note", "badge-info"] } as const;

type Item = { flag: Flag; index: number; where: string; rowId?: string };

export default async function UnitPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  const user = await requireUser();
  const data = await getUnitWithRows(unitId);
  if (!data) notFound();
  const { unit, rows } = data;

  const items: Item[] = [
    ...unit.flags.map((flag, index) => ({ flag, index, where: "Unit" })),
    ...rows.flatMap((r) => r.flags.map((flag, index) => ({ flag, index, where: `L${r.lessonNumber}`, rowId: r.id }))),
  ].sort((a, b) => SEVERITY_ORDER[a.flag.severity] - SEVERITY_ORDER[b.flag.severity]);

  const open = (s: Flag["severity"]) => items.filter((i) => i.flag.severity === s && !i.flag.resolution).length;
  const decisionsLeft = unresolvedErrors(unit.flags, rows);
  const canEdit = user.role === "expert" || user.role === "admin";

  return (
    <AppShell user={user} current="units">
      <main className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">
              Grade {unit.grade ?? "?"} · Unit {unit.unitNumber ?? "?"}
            </div>
            <h1>{unit.title}</h1>
          </div>
          <ol aria-label="Progress" className="row" style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
            <li className="badge badge-info">1 Import</li>
            <li className="badge badge-neutral">2 Generate</li>
            <li className="badge badge-neutral">3 Review</li>
            <li className="badge badge-neutral">4 Approve</li>
          </ol>
        </div>

        <section className="card card-pad row" aria-label="Source" style={{ gap: 16 }}>
          <h2>Source</h2>
          <span className="muted">{unit.sourceKind === "google_sheet" ? "Google Sheet" : unit.sourceRef}</span>
          <span className="muted">{rows.length} lesson rows</span>
        </section>

        <div className="stats">
          <div className="card card-pad">
            <div style={{ color: "var(--bad)", fontWeight: 600 }}>{open("error")} need a decision</div>
            <div className="muted">Generation waits on these</div>
          </div>
          <div className="card card-pad">
            <div style={{ color: "var(--warn)", fontWeight: 600 }}>{open("warning")} warnings</div>
            <div className="muted">Accept, or fix the sheet and re-import</div>
          </div>
          <div className="card card-pad">
            <div style={{ color: "var(--accent)", fontWeight: 600 }}>{open("info")} notes</div>
            <div className="muted">Reviewer notes become constraints only if you choose</div>
          </div>
        </div>

        <section className="card" aria-labelledby="flags">
          <div className="card-head">
            <h2 id="flags">Check the outline before generating</h2>
            <span className="muted">Nothing is picked for you. Each flag records who resolved it.</span>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Where</th>
                  <th scope="col">What we found</th>
                  <th scope="col">Your call</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ flag, index, where, rowId }) => {
                  const [label, cls] = SEVERITY_LABEL[flag.severity];
                  return (
                    <tr key={`${rowId ?? "unit"}-${index}`}>
                      <td>
                        <span className={`badge ${cls}`}>{label}</span>
                      </td>
                      <td>{where}</td>
                      <td>{flag.message}</td>
                      <td>
                        {flag.resolution ? (
                          <span className="muted">
                            {flag.resolution.note ? `${labelFor(flag, flag.resolution.note)} · ` : "Accepted · "}
                            {flag.resolution.by}
                          </span>
                        ) : canEdit ? (
                          <FlagControl unitId={unit.id} rowId={rowId} index={index} flag={flag} />
                        ) : (
                          <span className="muted">Open</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {canEdit && unit.status === "needs_review" && (
          <form action={confirmOutline} className="row" style={{ justifyContent: "flex-end" }}>
            <input type="hidden" name="unitId" value={unit.id} />
            <span className="muted">{decisionsLeft === 0 ? "All decisions made" : `${decisionsLeft} decisions left`}</span>
            <button className="btn btn-primary" type="submit" disabled={decisionsLeft > 0}>
              Confirm outline and continue
            </button>
          </form>
        )}
        {unit.status !== "needs_review" && (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Link className="btn btn-primary" href={`/units/${unit.id}/generate`}>
              Go to generation
            </Link>
          </div>
        )}
      </main>
    </AppShell>
  );
}

function labelFor(flag: Flag, note: string) {
  if (flag.code === "reviewer_note") return note === "use" ? "Used as constraint" : "Not used";
  return note;
}

function FlagControl({ unitId, rowId, index, flag }: { unitId: string; rowId?: string; index: number; flag: Flag }) {
  const hidden = (
    <>
      <input type="hidden" name="unitId" value={unitId} />
      {rowId && <input type="hidden" name="rowId" value={rowId} />}
      <input type="hidden" name="index" value={index} />
    </>
  );
  if (flag.options?.length) {
    return (
      <form action={resolveFlagAction} className="row">
        {hidden}
        <label className="sr-only" htmlFor={`c-${rowId}-${index}`}>
          Choose
        </label>
        <select className="input" id={`c-${rowId}-${index}`} name="choice" defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {flag.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <button className="btn btn-sm" type="submit">
          Save
        </button>
      </form>
    );
  }
  if (flag.code === "reviewer_note") {
    return (
      <div className="row">
        <form action={resolveFlagAction}>
          {hidden}
          <input type="hidden" name="choice" value="use" />
          <button className="btn btn-sm" type="submit">
            Use as constraint
          </button>
        </form>
        <form action={resolveFlagAction}>
          {hidden}
          <input type="hidden" name="choice" value="ignore" />
          <button className="btn btn-sm" type="submit">
            Ignore
          </button>
        </form>
      </div>
    );
  }
  return (
    <form action={resolveFlagAction}>
      {hidden}
      <button className="btn btn-sm" type="submit">
        {flag.code === "excerpt_needs_selection" ? "Mark for rights clearance" : "Accept"}
      </button>
    </form>
  );
}
