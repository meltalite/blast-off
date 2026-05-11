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

const THUMB_SIZE = 240;

function MediaContent({ message: m }: { message: Message }) {
  const mediaUrl = `/api/media/${encodeURIComponent(m.jid)}/${m.id}`;
  const [expanded, setExpanded] = useState(false);
  const caption = m.text ? (
    <div style={{ fontSize: 14, whiteSpace: "pre-wrap", marginTop: 4 }}>{m.text}</div>
  ) : null;

  if (m.mediaType === "image") {
    return (
      <div>
        <img
          src={mediaUrl}
          alt={m.text || "Photo"}
          onClick={() => setExpanded((v) => !v)}
          style={
            expanded
              ? { maxWidth: "100%", borderRadius: 8, display: "block", cursor: "zoom-out" }
              : {
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  objectFit: "cover",
                  borderRadius: 8,
                  display: "block",
                  cursor: "zoom-in",
                }
          }
        />
        {caption}
      </div>
    );
  }
  if (m.mediaType === "video") {
    if (!expanded) {
      return (
        <div>
          <div
            onClick={() => setExpanded(true)}
            style={{
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              position: "relative",
              cursor: "pointer",
              borderRadius: 8,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <video
              src={`${mediaUrl}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.25)",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  paddingLeft: 4,
                }}
              >
                ▶
              </div>
            </div>
          </div>
          {caption}
        </div>
      );
    }
    return (
      <div>
        <video
          src={mediaUrl}
          controls
          autoPlay
          style={{ maxWidth: "100%", borderRadius: 8, display: "block" }}
        />
        {caption}
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
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; mime: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const attachImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingImage({ dataUrl, mime: file.type });
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await attachImage(file);
          return;
        }
      }
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await attachImage(file);
    e.target.value = "";
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jid || sending) return;
    if (!pendingImage && !draft.trim()) return;
    setSending(true);
    setSendError(null);
    const text = draft.trim();
    const image = pendingImage;
    setDraft("");
    setPendingImage(null);
    try {
      const res = image
        ? await fetch("/api/messages/send-image", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify({ jid, caption: text, imageBase64: image.dataUrl }),
          })
        : await fetch("/api/messages/send", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify({ jid, text }),
          });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error ?? "Failed to send");
        setDraft(text);
        if (image) setPendingImage(image);
        return;
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id && m.id === data.id)) return prev;
        return [...prev, data as Message];
      });
    } catch {
      setSendError("Network error");
      setDraft(text);
      if (image) setPendingImage(image);
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
      {pendingImage && (
        <div style={styles.previewBar}>
          <img src={pendingImage.dataUrl} alt="Pending" style={styles.previewImg} />
          <span style={styles.previewLabel}>Image attached — press Send</span>
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            style={styles.previewRemove}
            aria-label="Remove image"
          >
            ✕
          </button>
        </div>
      )}
      <form onSubmit={send} style={styles.form}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFilePick}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={styles.attachBtn}
          aria-label="Attach image"
          title="Attach image"
        >
          📎
        </button>
        <input
          style={styles.input}
          placeholder={pendingImage ? "Add a caption…" : "Type a message… (paste an image to attach)"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={handlePaste}
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
  attachBtn: {
    padding: "0.4rem 0.7rem", borderRadius: 24, border: "none",
    background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1,
  },
  previewBar: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    padding: "0.5rem 1rem", background: "#f7f7f7", borderTop: "1px solid #e5e7eb",
  },
  previewImg: {
    width: 56, height: 56, objectFit: "cover", borderRadius: 6,
    border: "1px solid #e5e7eb",
  },
  previewLabel: { flex: 1, fontSize: 13, color: "#4b5563" },
  previewRemove: {
    border: "none", background: "transparent", cursor: "pointer",
    fontSize: 16, color: "#6b7280", padding: "0.25rem 0.5rem",
  },
};
