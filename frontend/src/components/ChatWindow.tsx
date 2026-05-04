import { useEffect, useRef, useState } from "react";
import { getSocket } from "../socket";
import { formatJid } from "../utils";

interface Message {
  id: string;
  jid: string;
  fromMe: boolean;
  timestamp: number;
  text: string;
  mediaType?: "image" | "video" | "audio" | "document";
  pushName?: string;
  status?: number; // 1=pending,2=server,3=delivered,4=read
}

function MediaContent({ message: m }: { message: Message }) {
  const mediaUrl = `/api/media/${encodeURIComponent(m.jid)}/${m.id}`;
  if (m.mediaType === "image") {
    return (
      <div>
        <img
          src={mediaUrl}
          alt={m.text || "Photo"}
          style={{ maxWidth: "100%", borderRadius: 8, display: "block", marginBottom: m.text ? 4 : 0 }}
        />
        {m.text && <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.text}</div>}
      </div>
    );
  }
  if (m.mediaType === "video") {
    return (
      <div>
        <video
          src={mediaUrl}
          controls
          style={{ maxWidth: "100%", borderRadius: 8, display: "block", marginBottom: m.text ? 4 : 0 }}
        />
        {m.text && <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.text}</div>}
      </div>
    );
  }
  if (m.mediaType === "audio") {
    return (
      <div>
        <audio src={mediaUrl} controls style={{ width: "100%" }} />
      </div>
    );
  }
  return <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.text}</div>;
}

// WhatsApp-style double checkmarks
function Checkmark({ status }: { status?: number }) {
  if (status === undefined) return null;
  const read = status >= 4;
  const delivered = status >= 3;
  const color = read ? "#53bdeb" : "#a0a0a0";
  if (status <= 1) {
    // Pending: clock
    return <span style={{ fontSize: 10, color: "#a0a0a0", marginLeft: 3 }}>🕐</span>;
  }
  if (!delivered) {
    // Server ack: single check
    return <span style={{ fontSize: 11, color, marginLeft: 3 }}>✓</span>;
  }
  // Delivered or read: double check
  return <span style={{ fontSize: 11, color, marginLeft: 3, letterSpacing: "-3px" }}>✓✓</span>;
}

interface Props {
  jid: string | null;
  name: string | null;
  authHeader: string;
}

export default function ChatWindow({ jid, name, authHeader }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jid) return;
    setMessages([]);
    setSendError(null);
    fetch(`/api/messages/${encodeURIComponent(jid)}`, {
      headers: { Authorization: authHeader },
    })
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setMessages(data) : undefined)
      .catch(console.error);
  }, [jid, authHeader]);

  useEffect(() => {
    const socket = getSocket();

    const handleNew = (msg: Message) => {
      if (msg.jid === jid) {
        setMessages((prev) => {
          if (prev.some((m) => m.id && m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    };

    const handleStatusUpdate = ({ id, status }: { id: string; jid: string; status: number }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status } : m))
      );
    };

    socket.on("new-message", handleNew);
    socket.on("message-status-update", handleStatusUpdate);
    return () => {
      socket.off("new-message", handleNew);
      socket.off("message-status-update", handleStatusUpdate);
    };
  }, [jid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jid || !draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    const text = draft.trim();
    setDraft("");
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ jid, text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error ?? "Failed to send");
        setDraft(text); // restore draft
        return;
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id && m.id === data.id)) return prev;
        return [...prev, data as Message];
      });
    } catch {
      setSendError("Network error");
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const title = name && name !== jid ? name : formatJid(jid ?? "");

  if (!jid) {
    return (
      <div style={{ ...styles.window, alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#9ca3af" }}>Select a conversation to start chatting</p>
      </div>
    );
  }

  return (
    <div style={styles.window}>
      <div style={styles.header}>
        <div style={styles.headerName}>{title}</div>
        <div style={styles.headerJid}>{jid}</div>
      </div>
      <div style={styles.messages}>
        {messages.length === 0 && (
          <p style={styles.noMessages}>No messages yet — history loads in the background</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id || `${m.jid}-${m.timestamp}`}
            style={{ display: "flex", justifyContent: m.fromMe ? "flex-end" : "flex-start", marginBottom: 6 }}
          >
            <div style={{ ...styles.bubble, background: m.fromMe ? "#d9fdd3" : "#fff" }}>
              {!m.fromMe && m.pushName && (
                <div style={styles.sender}>{m.pushName}</div>
              )}
              <MediaContent message={m} />
              <div style={styles.time}>
                {new Date((m.timestamp || 0) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {m.fromMe && <Checkmark status={m.status} />}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {sendError && <div style={styles.errorBar}>{sendError}</div>}
      <form onSubmit={send} style={styles.form}>
        <input
          style={styles.input}
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button style={{ ...styles.sendBtn, opacity: sending ? 0.6 : 1 }} type="submit" disabled={sending}>
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  window: { flex: 1, display: "flex", flexDirection: "column", background: "#efeae2" },
  header: {
    padding: "0.75rem 1rem", background: "#fff", borderBottom: "1px solid #e5e7eb",
  },
  headerName: { fontWeight: 600, fontSize: 15 },
  headerJid: { fontSize: 11, color: "#9ca3af", marginTop: 1 },
  messages: { flex: 1, overflowY: "auto", padding: "1rem" },
  noMessages: { textAlign: "center", color: "#9ca3af", fontSize: 13, marginTop: "2rem" },
  bubble: {
    maxWidth: "65%", padding: "0.5rem 0.75rem", borderRadius: 10,
    boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
  },
  sender: { fontSize: 11, color: "#128c7e", fontWeight: 600, marginBottom: 2 },
  text: { fontSize: 14 },
  time: { fontSize: 10, color: "#9ca3af", textAlign: "right", marginTop: 2 },
  errorBar: {
    background: "#fee2e2", color: "#dc2626", fontSize: 12,
    padding: "0.4rem 1rem", borderTop: "1px solid #fca5a5",
  },
  form: {
    display: "flex", gap: "0.5rem", padding: "0.75rem 1rem",
    background: "#f0f2f5", borderTop: "1px solid #e5e7eb",
  },
  input: {
    flex: 1, padding: "0.6rem 1rem", borderRadius: 24,
    border: "none", fontSize: 14, outline: "none",
  },
  sendBtn: {
    padding: "0.6rem 1.2rem", borderRadius: 24, border: "none",
    background: "#128c7e", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14,
  },
};
