import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { jwtVerify } from "jose";
import { approvals, auditLog, db, lessons, lessonVersions, users } from "@nl/db";
import { and, eq, isNull } from "@nl/db/orm";
import { contentHash, Lesson } from "@nl/schema";
import { lessonFromY, lessonToYUpdate } from "@nl/schema/editor";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "");
if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");

type Context = { userId: string; name: string; role: string; lessonId: string };

/**
 * Real-time co-editing, one Yjs document per lesson. Every connection carries a
 * short-lived token the web app signs for one user and one lesson room; room
 * names are random, so knowing a lesson id is not enough to join it.
 */
const server = new Server<Context>({
  port: Number(process.env.COLLAB_PORT || 1234),
  quiet: true,
  debounce: 1000,
  maxDebounce: 5000,

  async onAuthenticate({ token, documentName }) {
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(token, secret, { audience: "collab", issuer: "lesson-studio" }));
    } catch {
      throw new Error("Not authorized");
    }
    if (claims.room !== documentName || typeof claims.sub !== "string") throw new Error("Not authorized");
    const lesson = await db.query.lessons.findFirst({ where: eq(lessons.collabRoom, documentName) });
    const user = await db.query.users.findFirst({ where: eq(users.id, claims.sub) });
    if (!lesson || !user || lesson.id !== claims.lid) throw new Error("Not authorized");
    return { userId: user.id, name: user.name, role: user.role, lessonId: lesson.id } satisfies Context;
  },

  extensions: [
    new Database({
      async fetch({ documentName }) {
        const lesson = await db.query.lessons.findFirst({ where: eq(lessons.collabRoom, documentName) });
        if (!lesson) return null;
        if (lesson.collabState) return new Uint8Array(lesson.collabState);
        // First open: start from the latest generated draft. Nothing is stored until someone edits.
        if (!lesson.generatedVersionId) return null;
        const version = await db.query.lessonVersions.findFirst({ where: eq(lessonVersions.id, lesson.generatedVersionId) });
        const parsed = Lesson.safeParse(version?.content);
        return parsed.success ? lessonToYUpdate(parsed.data) : null;
      },

      async store({ documentName, state, document, lastContext }) {
        const [lesson] = await db
          .update(lessons)
          .set({ collabState: Buffer.from(state), updatedAt: new Date() })
          .where(eq(lessons.collabRoom, documentName))
          .returning({ id: lessons.id, unitId: lessons.unitId, status: lessons.status });
        if (!lesson || lesson.status !== "approved") return;

        // An edit to an approved lesson revokes the approval and sends it back to review.
        const active = await db.query.approvals.findFirst({ where: and(eq(approvals.lessonId, lesson.id), isNull(approvals.revokedAt)) });
        let hash: string | null = null;
        try {
          hash = contentHash(lessonFromY(document));
        } catch {
          // A document that no longer reads as a lesson is certainly not the approved one.
        }
        if (active && hash === active.contentHash) return;
        await db.transaction(async (tx) => {
          if (active) await tx.update(approvals).set({ revokedAt: new Date(), revokedReason: "Edited after approval" }).where(eq(approvals.id, active.id));
          await tx.update(lessons).set({ status: "in_review" }).where(eq(lessons.id, lesson.id));
          await tx.insert(auditLog).values({
            unitId: lesson.unitId,
            lessonId: lesson.id,
            actorId: lastContext?.userId,
            action: "approval.revoked",
            detail: { reason: "Edited after approval", approvalId: active?.id ?? null },
          });
        });
      },
    }),
  ],
});

await server.listen();
console.log(`collab: listening on ${server.configuration.port}`);
