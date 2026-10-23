"use client";

import { useActionState } from "react";
import type { Flag } from "@nl/db";
import { approveAction, runChecksAction, sendBackAction } from "./actions";

const TONE = { error: "badge-error", warning: "badge-warning", info: "badge-info" } as const;

export function ChecksPanel({ lessonId, initial }: { lessonId: string; initial: Flag[] }) {
  const [state, action, pending] = useActionState(runChecksAction, undefined);
  const flags = state?.flags ?? initial;
  return (
    <section className="card card-pad side" aria-labelledby="checks">
      <h2 id="checks">Checks</h2>
      {state?.error && <p role="alert" className="muted">{state.error}</p>}
      {flags.length === 0 ? (
        <p className="muted">All checks pass.</p>
      ) : (
        <ul className="flag-list">
          {flags.map((f, i) => (
            <li key={i}>
              <span className={`badge ${TONE[f.severity]}`}>{f.severity === "error" ? "Fix" : f.severity === "warning" ? "Check" : "Note"}</span> {f.message}
            </li>
          ))}
        </ul>
      )}
      <form action={action}>
        <input type="hidden" name="lessonId" value={lessonId} />
        <button className="btn btn-sm" type="submit" disabled={pending}>
          {pending ? "Checking…" : "Re-run checks on current text"}
        </button>
      </form>
      <p className="muted small">{state?.checkedAt ? "Checked just now." : "Shown: checks from generation. Edits save within a few seconds."}</p>
    </section>
  );
}

export function ApprovalPanel({ lessonId, canApprove, canSendBack, approved }: { lessonId: string; canApprove: boolean; canSendBack: boolean; approved: boolean }) {
  const [aState, approve, approving] = useActionState(approveAction, undefined);
  const [sState, sendBack, sending] = useActionState(sendBackAction, undefined);
  const msg = aState ?? sState;
  return (
    <div className="stack">
      {msg?.error && <p role="alert" className="alert alert-error">{msg.error}</p>}
      {msg?.ok && <p role="status" className="muted">{msg.ok}</p>}
      {canApprove && !approved && (
        <form action={approve}>
          <input type="hidden" name="lessonId" value={lessonId} />
          <button className="btn btn-approve" type="submit" disabled={approving}>
            {approving ? "Approving…" : "Approve this version"}
          </button>
        </form>
      )}
      {canSendBack && (
        <form action={sendBack} className="stack">
          <input type="hidden" name="lessonId" value={lessonId} />
          <label className="field">
            <span>Note for the team (optional)</span>
            <input className="input" name="note" maxLength={500} />
          </label>
          <button className="btn" type="submit" disabled={sending}>
            {approved ? "Revoke approval and send back" : "Send back to review"}
          </button>
        </form>
      )}
    </div>
  );
}
