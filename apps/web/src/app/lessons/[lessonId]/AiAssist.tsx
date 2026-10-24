"use client";

import { useState, useTransition } from "react";
import { SUGGESTION_KINDS, type SuggestionKind } from "@nl/schema/suggest";
import type { Suggestion } from "@/lib/suggestions";
import { resolveSuggestionAction, suggestAction } from "./actions";

export type AiTarget = { index: number; node: string; label: string; text: string };
export type ApplyResult = { ok: true } | { ok: false; reason: "stale" | "offline" } | { ok: false; reason: "busy"; who: string };

const KIND_LABELS: Record<SuggestionKind, string> = {
  clarify: "Make it clearer",
  simplify: "Simplify for grade 6",
  shorten: "Shorten",
  check: "Add a check for understanding",
  eld: "Add English learner support",
};

/**
 * AI-assisted editing. A reviewer asks for a rewrite of the block the cursor
 * is in; the answer is a tracked suggestion (stored, attributed to the model)
 * that changes nothing until the reviewer applies it.
 */
export function AiAssist({ lessonId, target, initial, apply }: { lessonId: string; target: AiTarget | null; initial: Suggestion[]; apply: (s: Suggestion) => ApplyResult }) {
  const [items, setItems] = useState<Suggestion[]>(initial);
  const [kind, setKind] = useState<SuggestionKind | "custom">("clarify");
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = items.filter((s) => s.status === "pending");

  function ask() {
    if (!target) return;
    setMessage(null);
    start(async () => {
      const res = await suggestAction(lessonId, { ...target, ...(kind === "custom" ? { custom } : { kind }) });
      if (res.error) setMessage(res.error);
      else if (res.suggestion) setItems((list) => [res.suggestion!, ...list]);
    });
  }

  function resolve(s: Suggestion, status: "applied" | "dismissed" | "stale") {
    setItems((list) => list.map((x) => (x.id === s.id ? { ...x, status } : x)));
    start(async () => {
      const res = await resolveSuggestionAction(s.id, status);
      if (res.error) setMessage(res.error);
    });
  }

  function onApply(s: Suggestion) {
    const result = apply(s);
    if (result.ok) return resolve(s, "applied");
    if (result.reason === "busy") return setMessage(`${result.who} is editing that block right now. Try again when they move on.`);
    if (result.reason === "offline") return setMessage("The editor is not connected. Wait for it to reconnect.");
    setMessage("That text has changed since the suggestion was made, so it was not applied. Ask again for a fresh one.");
    resolve(s, "stale");
  }

  return (
    <section className="ai-assist" aria-labelledby="ai-assist-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="ai-assist-h" className="ai-assist-title">
          AI suggestions
        </h2>
        <span className="muted small">{target ? `For: ${target.label}` : "Put the cursor in a block to ask for a rewrite."}</span>
      </div>
      <div className="row">
        <label className="sr-only" htmlFor="ai-kind">
          What to change
        </label>
        <select id="ai-kind" className="input input-sm" value={kind} onChange={(e) => setKind(e.target.value as SuggestionKind | "custom")}>
          {(Object.keys(SUGGESTION_KINDS) as SuggestionKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
          <option value="custom">Something else…</option>
        </select>
        {kind === "custom" && (
          <>
            <label className="sr-only" htmlFor="ai-custom">
              Your request
            </label>
            <input id="ai-custom" className="input input-sm" style={{ flex: "1 1 220px" }} maxLength={300} placeholder="e.g. Use a sports example" value={custom} onChange={(e) => setCustom(e.target.value)} />
          </>
        )}
        <button className="btn btn-sm" type="button" onClick={ask} disabled={!target || !target.text.trim() || pending || (kind === "custom" && !custom.trim())}>
          {pending ? "Working…" : "Suggest a rewrite"}
        </button>
      </div>
      {message && (
        <p role="alert" className="muted small">
          {message}
        </p>
      )}
      {open.length > 0 && (
        <ul className="suggestion-list">
          {open.map((s) => (
            <li key={s.id} className="suggestion">
              <div className="muted small">
                {s.target.label} · {s.instruction} · <span title="Model that wrote this suggestion">{s.modelId}</span>
              </div>
              <p className="suggestion-old">
                <span className="sr-only">Current text: </span>
                {s.originalText}
              </p>
              <p className="suggestion-new">
                <span className="sr-only">Suggested text: </span>
                {s.suggestedText}
              </p>
              {s.rationale && <p className="muted small">{s.rationale}</p>}
              <div className="row">
                <button className="btn btn-sm btn-primary" type="button" onClick={() => onApply(s)}>
                  Apply
                </button>
                <button className="btn btn-sm" type="button" onClick={() => resolve(s, "dismissed")}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
