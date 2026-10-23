import { approvals, db, lessons, outlineRows, units, users } from "@nl/db";
import { and, asc, eq, isNull } from "@nl/db/orm";
import { CCSS_NOTICE, Lesson } from "@nl/schema";
import { renderUnitHtml } from "@nl/schema/render";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Approved lessons only, exactly as frozen at approval (the snapshot, not the live document). */
export async function GET(req: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { unitId } = await params;
  const unit = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!unit) return new Response("Not found.", { status: 404 });

  const rows = await db
    .select({ lessonNumber: outlineRows.lessonNumber, approval: approvals, approver: users.name })
    .from(approvals)
    .innerJoin(lessons, eq(approvals.lessonId, lessons.id))
    .innerJoin(outlineRows, eq(lessons.outlineRowId, outlineRows.id))
    .innerJoin(users, eq(approvals.approverId, users.id))
    .where(and(eq(lessons.unitId, unitId), eq(lessons.status, "approved"), isNull(approvals.revokedAt)))
    .orderBy(asc(outlineRows.lessonNumber));

  const format = new URL(req.url).searchParams.get("format") === "html" ? "html" : "json";
  const base = `grade${unit.grade ?? "x"}-unit${unit.unitNumber ?? "x"}-approved`;
  if (format === "html") {
    const html = renderUnitHtml(unit.title, rows.map((r) => Lesson.parse(r.approval.snapshot)));
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="${base}.html"` } });
  }
  const body = {
    unit: { title: unit.title, grade: unit.grade, unitNumber: unit.unitNumber },
    exportedAt: new Date().toISOString(),
    exportedBy: user.name,
    standardsNotice: CCSS_NOTICE,
    lessons: rows.map((r) => ({
      lessonNumber: r.lessonNumber,
      approvedAt: r.approval.approvedAt,
      approvedBy: r.approver,
      contentHash: r.approval.contentHash,
      lesson: r.approval.snapshot,
    })),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${base}.json"` },
  });
}
