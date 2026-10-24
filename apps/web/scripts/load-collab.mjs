// Load test for real-time co-editing: N reviewers in one lesson's room, each making edits.
// Measures how long an edit takes to reach every other client (fan-out latency).
//
//   AUTH_SECRET=... node scripts/load-collab.mjs --url ws://localhost:1234 --lesson <id> --room <collab_room> --user <reviewer id> --clients 25
//
// Tokens are signed with AUTH_SECRET exactly as the web app signs them, so run it only against
// a deployment whose secret you hold. Edits go to a scratch "loadtest" map in the Yjs document,
// not the lesson text, but they are still stored: use a throwaway lesson.
import { HocuspocusProvider } from "@hocuspocus/provider";
import { SignJWT } from "jose";
import { parseArgs } from "node:util";
import * as Y from "yjs";

const { values: a } = parseArgs({
  options: { url: { type: "string" }, lesson: { type: "string" }, room: { type: "string" }, user: { type: "string" }, clients: { type: "string", default: "25" }, rounds: { type: "string", default: "10" } },
});
if (!a.url || !a.lesson || !a.room || !a.user || !process.env.AUTH_SECRET) {
  console.error("Needs --url --lesson --room --user and AUTH_SECRET.");
  process.exit(2);
}
const n = Number(a.clients);
const rounds = Number(a.rounds);
const key = new TextEncoder().encode(process.env.AUTH_SECRET);
const token = () =>
  new SignJWT({ room: a.room, lid: a.lesson, name: "load test" }).setProtectedHeader({ alg: "HS256" }).setSubject(a.user).setIssuer("lesson-studio").setAudience("collab").setIssuedAt().setExpirationTime("1h").sign(key);

const t0 = Date.now();
const clients = [];
for (let i = 0; i < n; i++) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: a.url, name: a.room, token: await token(), document: doc });
  clients.push({ doc, provider, synced: new Promise((r) => provider.on("synced", r)) });
}
await Promise.all(clients.map((c) => c.synced));
const syncMs = Date.now() - t0;

const lat = [];
for (let r = 0; r < rounds; r++) {
  for (let i = 0; i < n; i++) {
    const k = `${Date.now()}:${r}:${i}`;
    const start = performance.now();
    const seen = Promise.all(
      clients
        .filter((_, j) => j !== i)
        .map(
          (c) =>
            new Promise((res) => {
              const m = c.doc.getMap("loadtest");
              const h = () => m.has(k) && (m.unobserve(h), res());
              m.observe(h);
            }),
        ),
    );
    clients[i].doc.getMap("loadtest").set(k, r);
    await seen;
    lat.push(performance.now() - start);
  }
}
lat.sort((x, y) => x - y);
const q = (p) => lat[Math.floor(p * (lat.length - 1))].toFixed(1);
console.log(JSON.stringify({ clients: n, edits: lat.length, syncAllMs: syncMs, fanoutMs: { p50: +q(0.5), p95: +q(0.95), p99: +q(0.99), max: +q(1) } }));
clients.forEach((c) => c.provider.destroy());
process.exit(0);
