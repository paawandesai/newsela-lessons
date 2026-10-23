import { BLOCK_LABELS, FRONT_FIELDS, MOVE_LABELS } from "./editor";
import { SECTION_TITLES, type Block, type Lesson } from "./lesson";
import { CCSS_NOTICE } from "./standards";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const codes = (list: string[]) => (list.length ? esc(list.join(", ")) : "None");

function block(b: Block): string {
  if (b.type === "pulse_check") {
    const choices = b.choices
      .map((c) => `<li${c.correct ? ' class="correct"' : ""}><p>${esc(c.text)}${c.correct ? " <strong>(correct)</strong>" : ""}</p><p class="rationale">${esc(c.rationale)}</p></li>`)
      .join("");
    return `<div class="blk pulse"><h5>Pulse check${b.standards.length ? ` · ${codes(b.standards)}` : ""}</h5><p>${esc(b.question)}</p><ol type="A">${choices}</ol></div>`;
  }
  const label = b.type === "teacher_move" ? MOVE_LABELS[b.move] : BLOCK_LABELS[b.type];
  const text = b.type === "routine" ? b.name : b.type === "reflection" ? b.prompt : b.text;
  const std = b.type === "eld_support" && b.standards.length ? ` · ${codes(b.standards)}` : "";
  return `<div class="blk ${b.type}"><h5>${esc(label)}${std}</h5><p>${esc(text)}</p></div>`;
}

/** One approved lesson as a standalone HTML fragment. */
export function renderLessonHtml(lesson: Lesson): string {
  const fm = lesson.frontMatter;
  const front = [
    [FRONT_FIELDS["objective.content"], fm.objectives.content],
    [FRONT_FIELDS["objective.language"], fm.objectives.language],
    [FRONT_FIELDS["objective.foundationalSkills"], fm.objectives.foundationalSkills],
    ...fm.essentialQuestions.map((q) => [FRONT_FIELDS.essentialQuestion, q]),
    [FRONT_FIELDS["connection.knowledgeBuilding"], fm.connections.knowledgeBuilding],
    [FRONT_FIELDS["connection.enduringUnderstanding"], fm.connections.enduringUnderstanding],
    [FRONT_FIELDS["connection.futureLessons"], fm.connections.futureLessons],
    [FRONT_FIELDS["connection.performanceTask"], fm.connections.performanceTask],
  ]
    .map(([k, v]) => `<dt>${esc(k!)}</dt><dd>${esc(v!)}</dd>`)
    .join("");
  const texts = fm.texts.map((t) => `<li>${esc(t.title)}, ${esc(t.source)} (${esc(t.locator)})</li>`).join("");
  const sections = lesson.sections
    .map(
      (s) =>
        `<section class="${s.kind}"><h3>${SECTION_TITLES[s.kind]} · ${s.minutes} min</h3>` +
        s.parts
          .map((p) => `<div class="part"><h4>${esc(p.title)} · ${p.minutes} min${p.standards.length ? ` · ${codes(p.standards)}` : ""}</h4>${p.blocks.map(block).join("")}</div>`)
          .join("") +
        `</section>`,
    )
    .join("");
  return `<article class="lesson" id="lesson-${fm.lessonNumber}">
<h2>Lesson ${fm.lessonNumber}: ${esc(fm.title)}</h2>
<p class="meta">${esc(fm.lessonType)} · ${fm.durationMinutes} minutes</p>
<dl class="standards"><dt>Focus standards</dt><dd>${codes(fm.focusStandards)}</dd><dt>Supporting standards</dt><dd>${codes(fm.supportingStandards)}</dd><dt>ELD standards</dt><dd>${codes(fm.eldStandards)}</dd><dt>Vocabulary</dt><dd>${codes(fm.vocabulary)}</dd></dl>
<dl class="front">${front}</dl>
${texts ? `<h3>Texts</h3><ul class="texts">${texts}</ul>` : ""}
${sections}
</article>`;
}

/** A full HTML document for a set of approved lessons. */
export function renderUnitHtml(title: string, lessons: Lesson[]): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px;color:#1b1f24}h2{margin-top:48px;border-top:1px solid #d0d7de;padding-top:24px}dt{font-weight:600;margin-top:8px}dd{margin:0}.blk{margin:12px 0;padding:8px 12px;border-left:3px solid #d0d7de}.blk h5{margin:0;font-size:13px;color:#57606a;text-transform:uppercase;letter-spacing:.03em}.blk p{margin:4px 0}.rationale{color:#57606a;font-size:14px}footer{margin-top:48px;font-size:13px;color:#57606a}</style>
</head><body><h1>${esc(title)}</h1>
${lessons.map(renderLessonHtml).join("\n")}
<footer><p>${esc(CCSS_NOTICE)}</p><p>California English Language Development standards are referenced by code only; see the California Department of Education for their text.</p></footer>
</body></html>`;
}
