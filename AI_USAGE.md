# AI usage

## In the product

**What the model does.** The worker asks Claude (model set by `GENERATION_MODEL`, default `claude-opus-5-5`) to write one lesson per outline row. It runs through the Anthropic API with an organization API key, never a consumer account.

**What it receives.** A versioned system prompt (stored in `prompt_versions`) and one outline row. The row is fenced in a randomly tagged block and described as data. Only reviewer notes the content expert confirmed are passed as constraints, and neighboring lessons are summarized for continuity. No student data is involved.

**How the output is controlled.**
- Structured output: the response must match the lesson JSON schema, and it is parsed again with Zod.
- Automatic checks after every generation and on demand after edits: timing, standards alignment, codes limited to the outline row, ELD support, vocabulary, pulse-check answers, rights status of texts, and no quotation or page number that isn't in the outline row.
- Refusals and output cut off at the token limit are recorded and flagged, not silently retried. Server-side fallback is enabled, and each version records the model that actually answered.
- Each run has a spend cap. Budget is reserved before each call, so parallel jobs cannot exceed it.

**Provenance.** Every generated version stores the prompt version, the model id, the job, its token counts and cost, and the check results. The audit log records imports, flag decisions, runs, generations, approvals, and revocations. The lesson page shows whether people have edited the draft.

**Human control.** Nothing generated is final. Lessons go to review, people edit them, and only an approver can freeze a version. Any later edit revokes the approval.

## In building it

The codebase was written with Claude Code (Anthropic), working from a written plan and decisions the project owner approved. Tests cover the outline parser, the output checks, and the editor's lossless round trip. The flows were exercised end to end in a real browser, including two people editing the same lesson, approval, and revoke-on-edit. One example lesson was viewed by hand to learn the house format; no lesson content, outline, or third-party text is committed.
