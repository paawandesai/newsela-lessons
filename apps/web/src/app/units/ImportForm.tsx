"use client";

import { useActionState } from "react";
import { importUnit } from "./actions";

export function ImportForm() {
  const [state, action, pending] = useActionState(importUnit, undefined);
  return (
    <form action={action} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2>Import a unit outline</h2>
      <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
        <div className="field" style={{ flex: "1 1 280px" }}>
          <label htmlFor="file">Upload .xlsx or .csv</label>
          <input className="input" id="file" name="file" type="file" accept=".xlsx,.csv" style={{ paddingTop: 10 }} />
        </div>
        <span className="muted" style={{ paddingBottom: 12 }}>or</span>
        <div className="field" style={{ flex: "2 1 360px" }}>
          <label htmlFor="link">Google Sheets link</label>
          <input className="input" id="link" name="link" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" />
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        A linked sheet must be shared as &quot;Anyone with the link can view&quot;. Cell text is treated as data, never as instructions.
      </p>
      {state?.error && (
        <p role="alert" className="alert alert-error" style={{ margin: 0 }}>
          {state.error}
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import and check"}
        </button>
      </div>
    </form>
  );
}
