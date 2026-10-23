import { hash } from "@node-rs/argon2";
import { allCodes, officialUrl } from "@nl/schema";
import { db, sqlClient, standards, users } from "./index";

// Demo accounts only. Real deployments create users through an admin flow.
const password = process.env.SEED_PASSWORD;
if (!password) throw new Error("Set SEED_PASSWORD to seed demo accounts.");

const demo = [
  { email: "expert@demo.local", name: "Content Expert", role: "expert" as const },
  { email: "reviewer@demo.local", name: "Reviewer", role: "reviewer" as const },
  { email: "approver@demo.local", name: "Approver", role: "approver" as const },
];

const passwordHash = await hash(password);
for (const u of demo) {
  await db.insert(users).values({ ...u, passwordHash }).onConflictDoNothing({ target: users.email });
}
console.log(`seeded ${demo.length} demo accounts`);

// Standards: codes and official links only.
const codes = allCodes().map((c) => ({ ...c, officialUrl: officialUrl(c.code) }));
await db.insert(standards).values(codes).onConflictDoNothing({ target: standards.code });
console.log(`seeded ${codes.length} standards codes`);
await sqlClient.end();
