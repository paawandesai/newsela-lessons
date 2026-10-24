// Load test for the review workflow: N reviewers loading the review queue and lesson pages at once.
//
//   AUTH_SECRET=... node scripts/load-http.mjs --base http://localhost:3000 --unit <id> --user <reviewer id> --clients 25 --seconds 30
//   NL_SESSION=<cookie value> node scripts/load-http.mjs --base https://... --unit <id> --clients 25
//
// With AUTH_SECRET it signs a session cookie for --user, as the web app does; otherwise it uses NL_SESSION
// (copy the nl_session cookie from a signed-in browser). It only sends GET requests.
import { SignJWT } from "jose";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: { base: { type: "string" }, unit: { type: "string" }, user: { type: "string" }, clients: { type: "string", default: "25" }, seconds: { type: "string", default: "30" } },
});
if (!a.base || !a.unit) {
  console.error("Needs --base and --unit.");
  process.exit(2);
}
let cookie = process.env.NL_SESSION;
if (!cookie && process.env.AUTH_SECRET && a.user) {
  cookie = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(a.user).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
}
if (!cookie) {
  console.error("Needs NL_SESSION, or AUTH_SECRET with --user.");
  process.exit(2);
}
const headers = { cookie: `nl_session=${cookie}` };
const get = async (path) => {
  const t = performance.now();
  const res = await fetch(a.base + path, { headers, redirect: "manual" });
  const body = await res.text();
  return { ms: performance.now() - t, status: res.status, body };
};

// The lesson pages to visit, taken from the review queue.
const queue = await get(`/units/${a.unit}/review`);
if (queue.status !== 200) {
  console.error(`Review queue returned ${queue.status}. Check the cookie and unit id.`);
  process.exit(1);
}
const lessons = [...new Set([...queue.body.matchAll(/\/lessons\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
const paths = [`/units/${a.unit}/review`, ...lessons.map((id) => `/lessons/${id}`)];

const until = Date.now() + Number(a.seconds) * 1000;
const results = { queue: [], lesson: [] };
let errors = 0;
await Promise.all(
  Array.from({ length: Number(a.clients) }, async (_, i) => {
    for (let k = i; Date.now() < until; k++) {
      const path = paths[k % paths.length];
      const r = await get(path);
      if (r.status !== 200) errors++;
      (path.includes("/review") ? results.queue : results.lesson).push(r.ms);
    }
  }),
);
const stats = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const q = (p) => +s[Math.floor(p * (s.length - 1))]?.toFixed(0);
  return { requests: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
};
const total = results.queue.length + results.lesson.length;
console.log(JSON.stringify({ clients: Number(a.clients), seconds: Number(a.seconds), lessonsInUnit: lessons.length, requestsPerSecond: +(total / Number(a.seconds)).toFixed(1), errors, reviewQueueMs: stats(results.queue), lessonPageMs: stats(results.lesson) }));
