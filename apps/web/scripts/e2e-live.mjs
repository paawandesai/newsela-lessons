// End-to-end check of a running deployment, driven in a real browser.
// Signs in as each demo role, regenerates one lesson, asks for and applies an
// AI suggestion, re-runs checks, approves, edits to revoke, and exports.
//
//   E2E_PASSWORD=... NODE_PATH=$(npm root -g) node scripts/e2e-live.mjs --base https://host [--lesson 7]
//
// It changes data: one lesson is regenerated, edited, approved and revoked.
import { createRequire } from "node:module";

// Playwright is not a dependency of the app; use any installed copy (NODE_PATH works too).
const { chromium } = await import("playwright").catch(() => createRequire(import.meta.url)("playwright"));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const BASE = (args.base ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD;
const WANT_LESSON = args.lesson ? Number(args.lesson) : null;
const TIMEOUT = Number(args.timeout ?? 300_000);
if (!PASSWORD) throw new Error("Set E2E_PASSWORD to the demo accounts' password.");

const results = [];
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const browser = await chromium.launch();
async function signIn(role) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", `${role}@demo.local`);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }), page.click("button[type=submit]")]);
  return { ctx, page };
}

try {
  const health = await fetch(`${BASE}/api/health`);
  step("health endpoint", health.ok, String(health.status));

  // Reviewer: find the unit and a lesson that can be regenerated.
  const reviewer = await signIn("reviewer");
  step("reviewer signs in", true);
  const r = reviewer.page;
  await r.goto(`${BASE}/units`);
  const unitHref = await r.locator('a[href^="/units/"]').first().getAttribute("href");
  const unitId = unitHref.split("/")[2];
  await r.goto(`${BASE}/units/${unitId}/generate`);
  const buttons = r.locator('button[aria-label^="Regenerate lesson "]');
  const labels = await buttons.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  const numbers = labels.map((l) => Number(l.replace("Regenerate lesson ", "")));
  const lessonNumber = WANT_LESSON ?? numbers[0];
  if (!numbers.includes(lessonNumber)) throw new Error(`Lesson ${lessonNumber} can't be regenerated (edited or approved). Options: ${numbers.join(", ")}`);
  const row = r.locator("tr", { has: r.locator(`button[aria-label="Regenerate lesson ${lessonNumber}"]`) });
  const lessonHref = await row.locator('a[href^="/lessons/"]').first().getAttribute("href");
  const lessonId = lessonHref.split("/")[2];
  console.log(`unit ${unitId}, lesson ${lessonNumber} (${lessonId})`);

  // Regenerate and wait for a new version.
  await r.goto(`${BASE}/lessons/${lessonId}`);
  const before = await r.locator("dt:has-text('Generated') + dd").textContent();
  await r.goto(`${BASE}/units/${unitId}/generate`);
  await r.click(`button[aria-label="Regenerate lesson ${lessonNumber}"]`);
  const err = await r.locator("[role=alert]").first().textContent({ timeout: 3000 }).catch(() => null);
  if (err) step("regenerate queued", false, err.trim());
  const t0 = Date.now();
  let after = before;
  while (Date.now() - t0 < TIMEOUT) {
    await r.waitForTimeout(5000);
    await r.goto(`${BASE}/lessons/${lessonId}`);
    after = await r.locator("dt:has-text('Generated') + dd").textContent().catch(() => before);
    if (after !== before) break;
  }
  const model = await r.locator("dt:has-text('Model') + dd").textContent().catch(() => "?");
  step("lesson regenerated", after !== before, `${Math.round((Date.now() - t0) / 1000)}s, model ${model?.trim()}`);

  // AI suggestion: put the cursor in the first block, ask, apply.
  const editor = r.locator(".ProseMirror");
  await editor.waitFor({ timeout: 20_000 });
  await r.waitForTimeout(1500);
  const block = editor.locator(".blk:not(.blk-pulse_check)").first();
  await block.click();
  await r.selectOption("#ai-kind", "simplify");
  await r.click("button:has-text('Suggest a rewrite')");
  const suggestion = r.locator(".suggestion").first();
  const got = await suggestion.waitFor({ timeout: 120_000 }).then(() => true, () => false);
  const note = got ? "" : ((await r.locator(".ai-assist [role=alert]").textContent().catch(() => "")) ?? "").trim();
  const sModel = got ? (await suggestion.locator("span[title^='Model']").textContent()).trim() : "";
  step("AI suggestion returned", got, got ? `model ${sModel}` : note);
  if (got) {
    await block.click();
    await suggestion.locator("button:has-text('Apply')").click();
    const marked = await editor.locator(".ai-edit").first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
    step("suggestion applied and marked in the document", marked);
  }

  // Re-run checks on the edited text (edits save within a few seconds).
  await r.waitForTimeout(4000);
  await r.click("button:has-text('Re-run checks')");
  await r.locator("text=Checked just now.").waitFor({ timeout: 30_000 }).then(
    () => step("checks re-run", true),
    () => step("checks re-run", false),
  );
  const fixes = await r.locator(".flag-list .badge-error").count();
  console.log(`blocking flags after edit: ${fixes}`);

  // Expert: read-only, no AI panel.
  const expert = await signIn("expert");
  await expert.page.goto(`${BASE}/lessons/${lessonId}`);
  await expert.page.locator(".ProseMirror").waitFor({ timeout: 20_000 });
  const editable = await expert.page.locator(".ProseMirror").getAttribute("contenteditable");
  const aiPanel = await expert.page.locator(".ai-assist").count();
  step("expert sees a read-only editor without AI suggestions", editable === "false" && aiPanel === 0, `contenteditable=${editable}`);

  // Approver: approve, confirming quotes if asked.
  const approver = await signIn("approver");
  const a = approver.page;
  await a.goto(`${BASE}/lessons/${lessonId}`);
  const approveBtn = a.locator("button:has-text('Approve this version')");
  let approved = false;
  if (await approveBtn.count()) {
    await approveBtn.click();
    await a.waitForTimeout(3000);
    if (await a.locator("input[name=confirmQuotes]").count()) {
      step("approver asked to confirm unsourced quotes", true);
      await a.check("input[name=confirmQuotes]");
      await approveBtn.click();
      await a.waitForTimeout(3000);
    }
    await a.reload();
    approved = (await a.locator("dt:has-text('Approved by')").count()) > 0;
    const why = approved ? "" : ((await a.locator("[role=alert]").first().textContent().catch(() => "")) ?? "").trim();
    step("approver approves", approved, why);
  } else {
    step("approver approves", false, "no approve button");
  }

  // Export includes the approved lesson.
  const exp = await a.request.get(`${BASE}/api/units/${unitId}/export?format=json`);
  const body = exp.ok() ? await exp.json() : null;
  const inExport = !!body?.lessons?.some((l) => l.lessonNumber === lessonNumber);
  step("JSON export", exp.ok() && (!approved || inExport), `${exp.status()}, ${body?.lessons?.length ?? 0} lessons${approved ? `, includes L${lessonNumber}: ${inExport}` : ""}`);
  const html = await a.request.get(`${BASE}/api/units/${unitId}/export?format=html`);
  step("HTML export", html.ok(), String(html.status()));

  // Reviewer edit revokes the approval.
  if (approved) {
    await r.goto(`${BASE}/lessons/${lessonId}`);
    await editor.waitFor({ timeout: 20_000 });
    await r.waitForTimeout(1500);
    await editor.locator(".blk:not(.blk-pulse_check)").last().click();
    await r.keyboard.press("End");
    await r.keyboard.type(" (e2e edit)");
    let revoked = false;
    for (let i = 0; i < 10 && !revoked; i++) {
      await a.waitForTimeout(2000);
      await a.reload();
      revoked = (await a.locator("dt:has-text('Approved by')").count()) === 0;
    }
    step("an edit after approval revokes it", revoked);
  }
} catch (e) {
  step("run", false, e.message);
} finally {
  await browser.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
