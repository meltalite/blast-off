import React, { useEffect, useState } from "react";
import { getSocket } from "../socket";
import { formatJid } from "../utils";
import NewChatDialog from "./NewChatDialog";
import BulkSendDialog from "./BulkSendDialog";

interface Chat {
  jid: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
}

interface Props {
  selectedJid: string | null;
  onSelect: (jid: string, name?: string) => void;
  authHeader: string;
}

export default function ChatList({ selectedJid, onSelect, authHeader }: Props) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const fetchChats = () => {
    fetch("/api/chats", { headers: { Authorization: authHeader } })
      .then((r) => r.json())
      .then(setChats)
      .catch(console.error);
  };

  useEffect(() => {
    fetchChats();
    const socket = getSocket();
    socket.on("chats-updated", fetchChats);

    const handleNewMessage = (msg: { jid: string; text: string; timestamp: number; pushName?: string }) => {
      setChats((prev) => {
        const existing = prev.find((c) => c.jid === msg.jid);
        if (existing) {
          return [
            { ...existing, lastMessage: msg.text, timestamp: msg.timestamp },
            ...prev.filter((c) => c.jid !== msg.jid),
          ];
        }
        return [
          {
            jid: msg.jid,
            name: msg.pushName || formatJid(msg.jid),
            lastMessage: msg.text,
            timestamp: msg.timestamp,
            unreadCount: 1,
          },
          ...prev,
        ];
      });
    };

    socket.on("new-message", handleNewMessage);
    return () => {
      socket.off("new-message", handleNewMessage);
      socket.off("chats-updated", fetchChats);
    };
  }, [authHeader]);

  const displayName = (c: Chat) =>
    c.name && c.name !== c.jid ? c.name : formatJid(c.jid);

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        <span>Chats</span>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          <button style={styles.newBtn} title="Bulk send via CSV" onClick={() => setShowBulk(true)}>
            📤
          </button>
          <button style={styles.newBtn} title="New conversation" onClick={() => setShowNewChat(true)}>
            ✏️
          </button>
        </div>
      </div>
      {showNewChat && (
        <NewChatDialog
          onStart={(jid) => { onSelect(jid); }}
          onClose={() => setShowNewChat(false)}
        />
      )}
      {showBulk && (
        <BulkSendDialog
          authHeader={authHeader}
          onClose={() => setShowBulk(false)}
        />
      )}
      <div style={styles.list}>
        {chats.length === 0 && (
          <p style={styles.empty}>No conversations yet</p>
        )}
        {chats.map((c) => {
          const name = displayName(c);
          return (
            <div
              key={c.jid}
              style={{ ...styles.item, background: selectedJid === c.jid ? "#d9fdd3" : undefined }}
              onClick={() => onSelect(c.jid, displayName(c))}
            >
              <div style={styles.avatar}>{(name[0] ?? "?").toUpperCase()}</div>
              <div style={styles.info}>
                <div style={styles.name}>{name}</div>
                <div style={styles.preview}>{c.lastMessage}</div>
              </div>
              {c.unreadCount > 0 && (
                <span style={styles.badge}>{c.unreadCount}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 300, borderRight: "1px solid #e5e7eb", background: "#fff",
    display: "flex", flexDirection: "column", flexShrink: 0,
  },
  header: {
    padding: "0.75rem 1rem", fontWeight: 700, fontSize: 16,
    borderBottom: "1px solid #e5e7eb", color: "#128c7e",
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  newBtn: {
    background: "none", border: "none", cursor: "pointer",
    fontSize: 18, lineHeight: 1, padding: "0 0.25rem",
  },
  list: { overflowY: "auto", flex: 1 },
  empty: { padding: "1rem", color: "#9ca3af", fontSize: 13, textAlign: "center" },
  item: {
    display: "flex", alignItems: "center", gap: "0.75rem",
    padding: "0.75rem 1rem", cursor: "pointer", borderBottom: "1px solid #f3f4f6",
  },
  avatar: {
    width: 40, height: 40, borderRadius: "50%", background: "#128c7e", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: 16, flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0 },
  name: { fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  preview: { fontSize: 12, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  badge: {
    background: "#128c7e", color: "#fff", borderRadius: "50%",
    width: 20, height: 20, fontSize: 11, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
};
