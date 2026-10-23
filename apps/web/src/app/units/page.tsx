import Link from "next/link";
import { desc } from "@nl/db/orm";
import { db, units } from "@nl/db";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/session";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  needs_review: ["Check outline", "badge-warning"],
  ready: ["Ready to generate", "badge-info"],
  generating: ["Generating", "badge-info"],
  in_review: ["In review", "badge-info"],
  approved: ["Approved", "badge-ok"],
};

export default async function UnitsPage() {
  const user = await requireUser();
  const all = await db.select().from(units).orderBy(desc(units.createdAt));
  return (
    <AppShell user={user} current="units">
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Units</h1>
          </div>
        </div>
        {(user.role === "expert" || user.role === "admin") && <ImportForm />}
        <section className="card" aria-labelledby="unit-list">
          <div className="card-head">
            <h2 id="unit-list">All units</h2>
          </div>
          {all.length === 0 ? (
            <p className="card-pad muted" style={{ margin: 0 }}>
              No units yet.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col">Grade</th>
                    <th scope="col">Status</th>
                    <th scope="col">Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {all.map((u) => {
                    const [label, cls] = STATUS[u.status] ?? [u.status, "badge-neutral"];
                    return (
                      <tr key={u.id}>
                        <td>
                          <Link href={`/units/${u.id}`} style={{ fontWeight: 600 }}>
                            {u.title}
                          </Link>
                        </td>
                        <td>{u.grade ?? "—"}</td>
                        <td>
                          <span className={`badge ${cls}`}>{label}</span>
                        </td>
                        <td className="muted">{u.createdAt.toLocaleString("en-US")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}
