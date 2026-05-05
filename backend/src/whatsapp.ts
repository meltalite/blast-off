import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  useMultiFileAuthState,
  WAMessage,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import path from "path";

export const waEvents = new EventEmitter();

const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const STORE_FILE = path.join(SESSIONS_DIR, "store.json");

const store = makeInMemoryStore({});
// Restore persisted store so history survives restarts
store.readFromFile(STORE_FILE);
// Flush to disk every 15 seconds
setInterval(() => store.writeToFile(STORE_FILE), 15_000);

// Flush before process exits so no data is lost on Ctrl-C or server restart
const flushAndExit = (signal: string) => {
  console.log(`[store] flushing on ${signal}…`);
  store.writeToFile(STORE_FILE);
  process.exit(0);
};
process.once("SIGTERM", () => flushAndExit("SIGTERM"));
process.once("SIGINT", () => flushAndExit("SIGINT"));

let sock: WASocket | null = null;

export interface NormalizedMessage {
  id: string;
  jid: string;
  fromMe: boolean;
  timestamp: number;
  text: string;
  mediaType?: "image" | "video" | "audio" | "document";
  pushName?: string;
  status?: number; // proto.WebMessageInfo.Status: 1=pending,2=server,3=delivered,4=read
}

export interface NormalizedChat {
  jid: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
}

type MediaType = "image" | "video" | "audio" | "document";

function lookupName(jid: string): string | undefined {
  // 1. contacts store (saved contacts)
  const contact = store.contacts[jid];
  const fromContacts = contact?.name || contact?.notify || contact?.verifiedName;
  if (fromContacts) return fromContacts;

  // 2. pushName from any message sent by this JID across all buckets
  const phone = jid.replace(/@.*/, "");
  for (const bucket of Object.values(store.messages)) {
    for (const m of bucket.array) {
      const participant = m.key.participant ?? m.key.remoteJid ?? "";
      if ((participant.replace(/@.*/, "") === phone) && m.pushName) {
        return m.pushName;
      }
    }
  }
  return undefined;
}

function resolveMentions(text: string, mentionedJids: string[]): string {
  let result = text;
  for (const jid of mentionedJids) {
    const phone = jid.replace(/@.*/, "");
    const name = lookupName(jid);
    if (name) result = result.replace(`@${phone}`, `@${name}`);
  }
  return result;
}

function extractMessageContent(msg: WAMessage): { text: string; mediaType?: MediaType } {
  const c = msg.message;
  if (!c) return { text: "" };
  if (c.conversation) return { text: c.conversation };
  if (c.extendedTextMessage?.text) {
    const mentions = c.extendedTextMessage.contextInfo?.mentionedJid ?? [];
    const text = mentions.length
      ? resolveMentions(c.extendedTextMessage.text, mentions)
      : c.extendedTextMessage.text;
    return { text };
  }
  if (c.imageMessage) return { text: c.imageMessage.caption ?? "", mediaType: "image" };
  if (c.videoMessage) return { text: c.videoMessage.caption ?? "", mediaType: "video" };
  if (c.audioMessage) return { text: c.audioMessage.ptt ? "🎤 Voice note" : "🎵 Audio", mediaType: "audio" };
  if (c.documentMessage) return { text: `📄 ${c.documentMessage.fileName ?? "Document"}`, mediaType: "document" };
  if (c.stickerMessage) return { text: "🌀 Sticker" };
  if (c.locationMessage) return { text: "📍 Location" };
  if (c.contactMessage) return { text: `👤 ${c.contactMessage.displayName ?? "Contact"}` };
  if (c.reactionMessage) return { text: `Reacted ${c.reactionMessage.text || "👍"}` };
  if (c.pollCreationMessage) return { text: `📊 ${c.pollCreationMessage.name ?? "Poll"}` };
  // Protocol/system messages (ephemeral settings, key distribution, etc.) — hide them
  return { text: "" };
}

function extractText(msg: WAMessage): string {
  const { text, mediaType } = extractMessageContent(msg);
  if (mediaType === "image") return text ? `📷 ${text}` : "📷 Photo";
  if (mediaType === "video") return text ? `🎥 ${text}` : "🎥 Video";
  return text;
}

export async function startWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: true,
  });

  store.bind(sock.ev);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) waEvents.emit("qr", qr);

    if (connection === "open") {
      waEvents.emit("connection-status", "open");
    }

    if (connection === "close") {
      waEvents.emit("connection-status", "close");
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(() => startWhatsApp(), 3000);
    }

    if (connection === "connecting") waEvents.emit("connection-status", "connecting");
  });

  sock.ev.on("messaging-history.set", ({ chats, contacts, messages, isLatest }) => {
    const msgCount = messages?.length ?? 0;
    const chatCount = chats?.length ?? 0;
    console.log(`[history] batch arrived: ${msgCount} messages, ${chatCount} chats, isLatest=${isLatest}`);
    store.writeToFile(STORE_FILE);
    waEvents.emit("chats-updated");
  });

  sock.ev.on("messages.update", (updates) => {
    for (const { key, update } of updates) {
      if (update.status !== undefined && key.id && key.remoteJid) {
        waEvents.emit("message-status-update", {
          id: key.id,
          jid: key.remoteJid,
          status: update.status,
        });
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const { text, mediaType } = extractMessageContent(msg);
      if (!text && !mediaType) continue;
      const normalized: NormalizedMessage = {
        id: msg.key.id ?? "",
        jid: msg.key.remoteJid ?? "",
        fromMe: msg.key.fromMe ?? false,
        timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : 0,
        text,
        mediaType,
        pushName: msg.pushName ?? undefined,
        status: msg.status ?? undefined,
      };
      waEvents.emit("new-message", normalized);
    }
  });
}

export function getStoreStats() {
  const chatIds = store.chats?.all().map((c) => c.id) ?? [];
  const msgCounts: Record<string, number> = {};
  for (const id of chatIds) {
    msgCounts[id] = store.messages[id]?.array.length ?? 0;
  }
  return {
    chats: chatIds.length,
    contacts: Object.keys(store.contacts ?? {}).length,
    messageBuckets: Object.keys(store.messages).length,
    messagesPerChat: msgCounts,
  };
}

export async function resetSession(): Promise<void> {
  // Disconnect first so Baileys releases file handles
  sock?.end(undefined);
  sock = null;

  const fs = await import("fs");
  // Remove only auth state files, keep store.json so contact/chat names survive
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (f !== "store.json") {
      fs.unlinkSync(path.join(SESSIONS_DIR, f));
    }
  }
  console.log("[session] auth cleared — will re-scan QR on next startWhatsApp()");
}

export function getRawMessage(jid: string, msgId: string): WAMessage | null {
  // Try direct jid bucket first
  let msg = store.messages[jid]?.array.find((m) => m.key.id === msgId) ?? null;
  if (!msg) {
    // Fallback: search all buckets (LID vs phone JID mismatch)
    for (const bucket of Object.values(store.messages)) {
      msg = bucket.array.find((m) => m.key.id === msgId) ?? null;
      if (msg) break;
    }
  }
  return msg;
}

export { downloadMediaMessage };

export async function sendMessage(
  jid: string,
  text: string
): Promise<NormalizedMessage> {
  if (!sock) throw new Error("WhatsApp not connected");
  const sent = await sock.sendMessage(jid, { text });
  return {
    id: sent?.key.id ?? "",
    jid,
    fromMe: true,
    timestamp: Math.floor(Date.now() / 1000),
    text,
  };
}

export type Presence =
  | "available"
  | "unavailable"
  | "composing"
  | "recording"
  | "paused";

export async function sendPresence(jid: string | undefined, presence: Presence): Promise<void> {
  if (!sock) throw new Error("WhatsApp not connected");
  await sock.sendPresenceUpdate(presence, jid);
}

export async function subscribePresence(jid: string): Promise<void> {
  if (!sock) throw new Error("WhatsApp not connected");
  await sock.presenceSubscribe(jid);
}

function resolveDisplayName(jid: string, chatName?: string | null): string {
  if (chatName && chatName !== jid) return chatName;
  const name = lookupName(jid);
  if (name) return name;
  if (jid.endsWith("@s.whatsapp.net")) return "+" + jid.replace(/@.*/, "");
  return jid.replace(/@.*/, "");
}

export function getChats(): NormalizedChat[] {
  if (!store.chats) return [];
  return store.chats
    .all()
    .slice(0, 50)
    .map((chat) => {
      const arr = store.messages[chat.id]?.array ?? [];
      const last = arr[arr.length - 1];
      return {
        jid: chat.id,
        name: resolveDisplayName(chat.id, chat.name),
        lastMessage: last ? extractText(last) : "",
        timestamp: (last?.messageTimestamp as number) ?? 0,
        unreadCount: chat.unreadCount ?? 0,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function getMessages(jid: string): NormalizedMessage[] {
  // Try the JID directly; if empty, search all message buckets for a matching contact
  let arr = store.messages[jid]?.array ?? [];

  if (arr.length === 0) {
    // Fallback: find any bucket whose messages reference this JID (handles LID vs phone JID mismatch)
    for (const [key, bucket] of Object.entries(store.messages)) {
      if (key === jid) continue;
      const contact = store.contacts[key];
      const phone = "+" + key.replace(/@.*/, "");
      if (
        contact?.notify === jid ||
        contact?.name === jid ||
        phone === jid ||
        key.replace(/@.*/, "") === jid.replace(/@.*/, "")
      ) {
        arr = bucket.array;
        break;
      }
    }
  }

  return arr
    .slice(-50)
    .filter((m) => m.key?.id)
    .map((m) => {
      const { text, mediaType } = extractMessageContent(m);
      return {
        id: m.key.id ?? "",
        jid,
        fromMe: m.key.fromMe ?? false,
        timestamp: m.messageTimestamp ? Number(m.messageTimestamp) : 0,
        text,
        mediaType,
        pushName: m.pushName ?? undefined,
        status: m.status ?? undefined,
      };
    })
    .filter((m) => m.text || m.mediaType); // drop protocol messages with no visible content
}
