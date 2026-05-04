import React, { useState } from "react";
import { phoneToJid } from "../utils";

interface Props {
  onStart: (jid: string) => void;
  onClose: () => void;
}

export default function NewChatDialog({ onStart, onClose }: Props) {
  const [phone, setPhone] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (!digits) return;
    onStart(phoneToJid(digits));
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>New conversation</h3>
        <form onSubmit={submit}>
          <input
            style={styles.input}
            placeholder="Phone number (e.g. 6281234567890)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
          />
          <p style={styles.hint}>Include country code, no + or spaces needed</p>
          <div style={styles.actions}>
            <button type="button" style={styles.cancel} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.start}>Start chat</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
  },
  dialog: {
    background: "#fff", borderRadius: 12, padding: "1.5rem",
    width: 320, boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
  },
  title: { marginBottom: "1rem", color: "#128c7e", fontSize: 16 },
  input: {
    width: "100%", padding: "0.6rem 0.8rem", borderRadius: 8,
    border: "1px solid #d1d5db", fontSize: 14, outline: "none",
    boxSizing: "border-box",
  },
  hint: { fontSize: 11, color: "#9ca3af", marginTop: "0.4rem" },
  actions: { display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" },
  cancel: {
    padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #d1d5db",
    background: "#fff", cursor: "pointer", fontSize: 13,
  },
  start: {
    padding: "0.5rem 1rem", borderRadius: 8, border: "none",
    background: "#128c7e", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
  },
};
