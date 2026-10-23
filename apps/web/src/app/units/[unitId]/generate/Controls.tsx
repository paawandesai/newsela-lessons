"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { cancelRunAction, regenerateAction, startRunAction } from "./actions";

/** Re-reads the server page every few seconds while lessons are still being written. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function StartButton({ unitId, label }: { unitId: string; label: string }) {
  const [state, action, pending] = useActionState(startRunAction, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="unitId" value={unitId} />
      {state?.error && <span role="alert" className="badge badge-error">{state.error}</span>}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Starting…" : label}
      </button>
    </form>
  );
}

export function CancelButton({ unitId, runId }: { unitId: string; runId: string }) {
  const [, action, pending] = useActionState(cancelRunAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="runId" value={runId} />
      <button className="btn" type="submit" disabled={pending}>
        Stop run
      </button>
    </form>
  );
}

export function RegenerateButton({ unitId, lessonId, lessonNumber }: { unitId: string; lessonId: string; lessonNumber: number }) {
  const [state, action, pending] = useActionState(regenerateAction, undefined);
  return (
    <form action={action} className="row" style={{ gap: 6 }}>
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <button className="btn btn-sm" type="submit" disabled={pending} aria-label={`Regenerate lesson ${lessonNumber}`}>
        {pending ? "Queuing…" : "Regenerate"}
      </button>
      {state?.error && <span role="alert" className="muted">{state.error}</span>}
    </form>
  );
}
