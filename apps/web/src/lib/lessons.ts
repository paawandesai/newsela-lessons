import "server-only";
import { SignJWT } from "jose";
import { approvals, auditLog, db, lessons, lessonVersions, outlineRows, rowContext, units, users, type Flag } from "@nl/db";
import { and, desc, eq, isNull } from "@nl/db/orm";
import { contentHash, hasBlocking, Lesson, validateLesson } from "@nl/schema";
import { lessonFromY } from "@nl/schema/editor";
import type { SessionUser } from "./session";

export class LessonError extends Error {}

export async function getLesson(lessonId: string) {
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
  if (!lesson) return null;
  const [row, unit, version, approval] = await Promise.all([
    db.query.outlineRows.findFirst({ where: eq(outlineRows.id, lesson.outlineRowId) }),
    db.query.units.findFirst({ where: eq(units.id, lesson.unitId) }),
    lesson.generatedVersionId ? db.query.lessonVersions.findFirst({ where: eq(lessonVersions.id, lesson.generatedVersionId) }) : undefined,
    activeApproval(lesson.id),
  ]);
  const approver = approval ? await db.query.users.findFirst({ where: eq(users.id, approval.approverId) }) : undefined;
  return { lesson, row: row!, unit: unit!, version, approval, approverName: approver?.name };
}

function activeApproval(lessonId: string) {
  return db.query.approvals.findFirst({ where: and(eq(approvals.lessonId, lessonId), isNull(approvals.revokedAt)), orderBy: desc(approvals.approvedAt) });
}

/** The lesson as it stands now: the saved collaborative document, or the generated draft if nobody has edited it. */
async function currentContent(lessonId: string): Promise<{ lesson: typeof lessons.$inferSelect; content: Lesson }> {
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
  if (!lesson) throw new LessonError("Lesson not found.");
  if (lesson.collabState) return { lesson, content: lessonFromY(new Uint8Array(lesson.collabState)) };
  if (!lesson.generatedVersionId) throw new LessonError("This lesson has not been generated yet.");
  const version = await db.query.lessonVersions.findFirst({ where: eq(lessonVersions.id, lesson.generatedVersionId) });
  const parsed = Lesson.safeParse(version?.content);
  if (!parsed.success) throw new LessonError("The generated draft does not match the lesson format. Regenerate it.");
  return { lesson, content: parsed.data };
}

/** Re-runs the output checks on the current text. A flagged lesson that now passes moves to review. */
export async function runChecks(lessonId: string): Promise<Flag[]> {
  const { lesson, content } = await currentContent(lessonId);
  const row = (await db.query.outlineRows.findFirst({ where: eq(outlineRows.id, lesson.outlineRowId) }))!;
  const flags = validateLesson(content, rowContext(row));
  if (lesson.status === "flagged" && !hasBlocking(flags)) {
    await db.update(lessons).set({ status: "in_review", updatedAt: new Date() }).where(eq(lessons.id, lessonId));
  }
  return flags;
}

/** Freezes the lesson as it stands: a snapshot, its SHA-256, and who approved it. */
export async function approve(lessonId: string, user: SessionUser) {
  const { lesson, content } = await currentContent(lessonId);
  if (lesson.status === "approved") throw new LessonError("Already approved.");
  const row = (await db.query.outlineRows.findFirst({ where: eq(outlineRows.id, lesson.outlineRowId) }))!;
  const flags = validateLesson(content, rowContext(row));
  if (hasBlocking(flags)) throw new LessonError("Fix the failing checks before approving.");
  const hash = contentHash(content);
  await db.transaction(async (tx) => {
    const [a] = await tx.insert(approvals).values({ lessonId, approverId: user.id, contentHash: hash, snapshot: content }).returning({ id: approvals.id });
    await tx.update(lessons).set({ status: "approved", updatedAt: new Date() }).where(eq(lessons.id, lessonId));
    await tx.insert(auditLog).values({ unitId: lesson.unitId, lessonId, actorId: user.id, action: "lesson.approved", detail: { approvalId: a!.id, contentHash: hash } });
  });
  return hash;
}

export async function sendBack(lessonId: string, user: SessionUser, note: string) {
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
  if (!lesson) throw new LessonError("Lesson not found.");
  await db.transaction(async (tx) => {
    await tx
      .update(approvals)
      .set({ revokedAt: new Date(), revokedReason: note || "Sent back" })
      .where(and(eq(approvals.lessonId, lessonId), isNull(approvals.revokedAt)));
    await tx.update(lessons).set({ status: "in_review", updatedAt: new Date() }).where(eq(lessons.id, lessonId));
    await tx.insert(auditLog).values({ unitId: lesson.unitId, lessonId, actorId: user.id, action: "lesson.sent_back", detail: { note } });
  });
}

/** A two-hour token that admits one user to one lesson's room on the collaboration server. */
export async function collabToken(user: SessionUser, lesson: { id: string; collabRoom: string }) {
  return new SignJWT({ room: lesson.collabRoom, lid: lesson.id, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("lesson-studio")
    .setAudience("collab")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
}
