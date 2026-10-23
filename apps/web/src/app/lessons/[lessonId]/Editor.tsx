"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { redo, undo, yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import * as Y from "yjs";
import { FRAGMENT, lessonSchema } from "@nl/schema/editor";

const COLORS = ["#1f5fbf", "#1a7f37", "#8a4b00", "#8250df", "#b42318", "#0f766e"];

type Peer = { name: string; color: string };
type Status = "connecting" | "connected" | "disconnected";

export function Editor({ url, room, token, user, readOnlyNote }: { url: string; room: string; token: string; user: { id: string; name: string }; readOnlyNote?: string }) {
  const mount = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        attributes: { "aria-label": "Lesson text", class: "lesson-doc" },
      });
    };
    provider.on("synced", onSynced);
    if (provider.isSynced) onSynced();

    return () => {
      awareness.off("change", onAwareness);
      view?.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [url, room, token, user.id, user.name]);

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
      <div ref={mount} />
    </div>
  );
}
