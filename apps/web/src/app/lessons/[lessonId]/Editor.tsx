"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { redo, relativePositionToAbsolutePosition, undo, yCursorPlugin, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from "y-prosemirror";
import * as Y from "yjs";
import { FRAGMENT, lessonSchema, SUGGESTIBLE, suggestibleLabel } from "@nl/schema/editor";
import { AiAssist, type AiTarget, type ApplyResult } from "./AiAssist";
import type { Suggestion } from "@/lib/suggestions";

const COLORS = ["#1f5fbf", "#1a7f37", "#8a4b00", "#8250df", "#b42318", "#0f766e"];

type Peer = { name: string; color: string };
type Status = "connecting" | "connected" | "disconnected";

const isSuggestible = (n: PMNode) => (SUGGESTIBLE as readonly string[]).includes(n.type.name);

/** The suggestible text blocks in document order, with their positions. Suggestions point at one by index. */
function suggestibleNodes(doc: PMNode): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (isSuggestible(node)) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

function targetAt(state: EditorState): AiTarget | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (!isSuggestible(node)) continue;
    const pos = $from.before(d);
    const index = suggestibleNodes(state.doc).findIndex((n) => n.pos === pos);
    return index < 0 ? null : { index, node: node.type.name, label: suggestibleLabel(node), text: node.textContent };
  }
  return null;
}

export function Editor({
  url,
  room,
  token,
  user,
  readOnly,
  readOnlyNote,
  lessonId,
  suggestions,
}: {
  url: string;
  room: string;
  token: string;
  user: { id: string; name: string };
  readOnly?: boolean;
  readOnlyNote?: string;
  lessonId: string;
  suggestions: Suggestion[];
}) {
  const mount = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<AiTarget | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const color = COLORS[[...user.id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]!;
    const provider = new HocuspocusProvider({
      url,
      name: room,
      token,
      document: ydoc,
      onStatus: ({ status }) => setStatus(status as Status),
      onAuthenticationFailed: () => setError("You don't have access to this lesson, or your session expired. Reload the page."),
    });
    providerRef.current = provider;
    const awareness = provider.awareness!;
    awareness.setLocalStateField("user", { name: user.name, color });
    const onAwareness = () =>
      setPeers(
        [...awareness.getStates().entries()]
          .filter(([id, s]) => id !== awareness.clientID && s.user)
          .map(([, s]) => s.user as Peer),
      );
    awareness.on("change", onAwareness);

    let view: EditorView | null = null;
    // Mount only after the first sync, so an empty local document is never written over the shared one.
    const onSynced = () => {
      if (view || !mount.current) return;
      view = new EditorView(mount.current, {
        state: EditorState.create({
          schema: lessonSchema,
          plugins: [
            ySyncPlugin(ydoc.getXmlFragment(FRAGMENT)),
            yCursorPlugin(awareness),
            yUndoPlugin(),
            keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
            keymap(baseKeymap),
          ],
        }),
        editable: () => !readOnly,
        attributes: { "aria-label": "Lesson text", class: "lesson-doc" },
        dispatchTransaction(this: EditorView, tr) {
          // `this`, not `view`: y-prosemirror dispatches while the view is still being constructed.
          this.updateState(this.state.apply(tr));
          if (tr.selectionSet || tr.docChanged) setTarget(targetAt(this.state));
        },
      });
      viewRef.current = view;
    };
    provider.on("synced", onSynced);
    if (provider.isSynced) onSynced();

    return () => {
      awareness.off("change", onAwareness);
      view?.destroy();
      viewRef.current = null;
      providerRef.current = null;
      provider.destroy();
      ydoc.destroy();
    };
  }, [url, room, token, user.id, user.name, readOnly]);

  /**
   * Applies a suggestion to the shared document, marked as AI text. Refuses when
   * the block changed since the suggestion was made, or while another person's
   * cursor is in it, so a suggestion never overwrites someone's work.
   */
  function apply(s: Suggestion): ApplyResult {
    const view = viewRef.current;
    const awareness = providerRef.current?.awareness;
    if (!view || !awareness) return { ok: false, reason: "offline" };
    const found = suggestibleNodes(view.state.doc)[s.target.index];
    if (!found || found.node.type.name !== s.target.node || found.node.textContent !== s.originalText) return { ok: false, reason: "stale" };
    const from = found.pos;
    const to = found.pos + found.node.nodeSize;

    const ystate = ySyncPluginKey.getState(view.state);
    for (const [id, st] of awareness.getStates()) {
      if (id === awareness.clientID || !st.cursor || !ystate?.binding) continue;
      const at = relativePositionToAbsolutePosition(ystate.doc, ystate.type, Y.createRelativePositionFromJSON(st.cursor.head), ystate.binding.mapping);
      if (at !== null && at > from && at < to) return { ok: false, reason: "busy", who: (st.user as Peer | undefined)?.name ?? "Someone" };
    }

    const mark = lessonSchema.marks.ai!.create({ suggestion: s.id, model: s.modelId });
    const content = s.suggestedText ? lessonSchema.text(s.suggestedText, [mark]) : null;
    const tr = view.state.tr.replaceWith(from + 1, to - 1, content ?? []);
    view.dispatch(tr);
    return { ok: true };
  }

  return (
    <div className="editor">
      <div className="editor-bar" role="status">
        <span className={`dot dot-${status}`} aria-hidden />
        <span>{status === "connected" ? "Live. Changes save automatically." : status === "connecting" ? "Connecting…" : "Offline. Reconnecting…"}</span>
        <span className="presence" aria-label="Also editing">
          {peers.map((p, i) => (
            <span key={i} className="avatar" style={{ background: p.color }} title={p.name}>
              {p.name
                .split(/\s+/)
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
          ))}
        </span>
      </div>
      {readOnlyNote && <p className="editor-note">{readOnlyNote}</p>}
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      {!readOnly && <AiAssist lessonId={lessonId} target={target} initial={suggestions} apply={apply} />}
      <div ref={mount} />
    </div>
  );
}
