# AI usage

## In the product

**What the model does.** The worker asks Claude (model set by `GENERATION_MODEL`, default `claude-opus-5-5`) to write one lesson per outline row. It runs through the Anthropic API with an organization API key, never a consumer account.

It also writes **AI suggestions**: a reviewer selects a block in a lesson and asks for a rewrite (clearer, simpler, shorter, a check for understanding, English learner support, or their own request). The model returns replacement text and a one-line rationale; the reviewer sees old and new text side by side and decides whether to apply it.

**What it receives.** A versioned system prompt (stored in `prompt_versions`) and one outline row. Everything that comes from the sheet (the row, unit title, anchor text and neighbor summaries) is fenced in one randomly tagged block with angle brackets neutralized, and described as data. Only reviewer notes the content expert confirmed are passed as constraints; the cell text still reaches the model inside the fence. For suggestions, the model gets the block's text and the reviewer's request, fenced the same way. No student data is involved.

**How the output is controlled.**
- Structured output: the response must match the lesson JSON schema, and it is parsed again with Zod.
- Automatic checks after every generation and on demand after edits. These block approval: missing sections, minutes not totalling 50 per day, focus standards not taught, unknown codes, pulse checks without exactly one correct answer, anchor texts not marked reference-only, and page numbers not in the outline row. These are warnings: codes outside the row, vocabulary or ELD support that differs from the row, brand names, Lexile, and quoted passages of 8+ words not found in the outline. The approver must confirm each unmatched quotation before approving. Paraphrased copyrighted text is not detected; reviewers are the control for that.
- Refusals and output cut off at the token limit are recorded and flagged, not silently retried. Server-side fallback is enabled, and each version records the model that actually answered.
- Spend is capped per unit (default $25, across all runs, regenerations and suggestions) and per day (default $100). Each call first reserves its worst-case cost in one database transaction and is skipped if either cap would be passed; the reservation is then trued up to the real cost. Runs, regenerations and suggestions are also rate-limited per user.

**Provenance.** Every generated version stores the prompt version, the model id, the job, its token counts and cost, and the check results. The audit log records imports, flag decisions, runs, generations, approvals, and revocations. The lesson page shows the prompt version, whether people have edited the draft, and whether AI suggestions were applied. Each suggestion is stored with its model, cost, request, old and new text, and who applied or dismissed it; applied text carries a mark in the document naming the suggestion and model.

**Human control.** Nothing generated is final. Lessons go to review, reviewers edit them (experts and approvers read along), suggestions change nothing until a reviewer applies them, and only an approver can freeze a version. Any later edit revokes the approval.

## In building it

The codebase was written with Claude Code (Anthropic's coding agent), working from a written plan and decisions the project owner approved. A final audit by a separate Claude session checked the docs against the code and drove the fixes in this version. Tests cover the outline parser, the output checks, prompt fencing, sheet links, and the editor's lossless round trip. The flows were exercised end to end in a real browser, including two people editing the same lesson, approval, and revoke-on-edit. One example lesson was viewed by hand to learn the house format; no lesson content, outline, or third-party text is committed.

**Not independently verified.** The standards code list (`packages/schema/src/standards.ts`) was compiled by the agent from the published CCSS and CA ELD frameworks and has not been checked against the official documents line by line. The house lesson format was inferred from one example. The model's output has been checked only by the automatic checks and by viewing a handful of lessons, not by a content expert.
