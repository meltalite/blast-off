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
const ALIAS_FILE = path.join(SESSIONS_DIR, "aliases.json");

// Persistent lid -> canonical-jid map. Survives restarts so manually-paired
// contacts (and pairings learned via chats.phoneNumberShare) aren't lost.
const aliasOverrides = new Map<string, string>();

function loadAliasOverrides(): void {
  try {
    const fs = require("fs") as typeof import("fs");
    if (!fs.existsSync(ALIAS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) aliasOverrides.set(k, v);
  } catch (err) {
    console.warn("[aliases] failed to load", err);
  }
}

function saveAliasOverrides(): void {
  try {
    const fs = require("fs") as typeof import("fs");
    const obj: Record<string, string> = {};
    for (const [k, v] of aliasOverrides) obj[k] = v;
    fs.writeFileSync(ALIAS_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn("[aliases] failed to save", err);
  }
}

loadAliasOverrides();

export function setAlias(lid: string, jid: string): void {
  aliasOverrides.set(lid, jid);
  // Bidirectional: looking up the phone-jid should also resolve to itself
  // (no-op), but if someone passes the phone-jid into canonicalJid we still
  // want it returned unchanged — which is the default. We only store lid→jid.
  saveAliasOverrides();
  waEvents.emit("chats-updated");
}

export function removeAlias(lid: string): void {
  aliasOverrides.delete(lid);
  saveAliasOverrides();
  waEvents.emit("chats-updated");
}

export function listAliases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of aliasOverrides) out[k] = v;
  return out;
}

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

function buildAliasMap(): Map<string, string> {
  // Maps every known alias (both @lid and @s.whatsapp.net) of a contact to a
  // single canonical JID. Prefer @s.whatsapp.net when both are known.
  const map = new Map<string, string>();
  // 1. Persistent manual / phoneNumberShare-learned pairings (lid -> phoneJid)
  for (const [lid, jid] of aliasOverrides) {
    map.set(lid, jid);
    map.set(jid, jid);
  }
  // 2. Pairings Baileys populated in its own contact records
  for (const c of Object.values(store.contacts ?? {})) {
    if (!c) continue;
    const id = (c as { id?: string }).id;
    const lid = (c as { lid?: string }).lid;
    if (id && lid) {
      const canonical = id.endsWith("@s.whatsapp.net") ? id : lid;
      if (!map.has(id)) map.set(id, canonical);
      if (!map.has(lid)) map.set(lid, canonical);
    }
  }
  return map;
}

function canonicalJid(jid: string, aliasMap?: Map<string, string>): string {
  return (aliasMap ?? buildAliasMap()).get(jid) ?? jid;
}

function lookupName(jid: string): string | undefined {
  // 1. contacts store — try the requested jid and any aliased form
  const aliasMap = buildAliasMap();
  const canonical = aliasMap.get(jid) ?? jid;
  const aliases = new Set<string>([jid, canonical]);
  for (const [alias, target] of aliasMap) {
    if (target === canonical) aliases.add(alias);
  }
  for (const a of aliases) {
    const c = store.contacts[a];
    const n = c?.name || c?.notify || c?.verifiedName;
    if (n) return n;
  }

  // 2. pushName from any message whose sender matches one of the aliases
  for (const bucket of Object.values(store.messages)) {
    for (const m of bucket.array) {
      const participant = m.key.participant ?? m.key.remoteJid ?? "";
      if (aliases.has(participant) && m.pushName) return m.pushName;
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

  sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
    if (lid && jid) {
      console.log(`[aliases] learned ${lid} <-> ${jid} via phoneNumberShare`);
      aliasOverrides.set(lid, jid);
      saveAliasOverrides();
      waEvents.emit("chats-updated");
    }
  });

  sock.ev.on("messaging-history.set", ({ chats, contacts, messages, isLatest }) => {
    const msgCount = messages?.length ?? 0;
    const chatCount = chats?.length ?? 0;
    console.log(`[history] batch arrived: ${msgCount} messages, ${chatCount} chats, isLatest=${isLatest}`);
    store.writeToFile(STORE_FILE);
    waEvents.emit("chats-updated");
  });

  sock.ev.on("messages.update", (updates) => {
    const aliasMap = buildAliasMap();
    for (const { key, update } of updates) {
      if (update.status !== undefined && key.id && key.remoteJid) {
        waEvents.emit("message-status-update", {
          id: key.id,
          jid: aliasMap.get(key.remoteJid) ?? key.remoteJid,
          status: update.status,
        });
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    const aliasMap = buildAliasMap();
    for (const msg of messages) {
      if (!msg.message) continue;
      const { text, mediaType } = extractMessageContent(msg);
      if (!text && !mediaType) continue;
      const rawJid = msg.key.remoteJid ?? "";
      const normalized: NormalizedMessage = {
        id: msg.key.id ?? "",
        jid: aliasMap.get(rawJid) ?? rawJid,
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

// Raw chat list with no alias merging — used by the admin UI / API to pick
// the two JIDs that belong to the same person when pairing manually.
export function getRawChats(): Array<{
  jid: string;
  name: string;
  pushName?: string;
  lastMessage: string;
  timestamp: number;
}> {
  if (!store.chats) return [];
  return store.chats
    .all()
    .map((chat) => {
      const arr = store.messages[chat.id]?.array ?? [];
      const last = arr[arr.length - 1];
      const pushName = arr.find((m) => !m.key.fromMe && m.pushName)?.pushName ?? undefined;
      return {
        jid: chat.id,
        name: chat.name ?? pushName ?? chat.id.replace(/@.*/, ""),
        pushName,
        lastMessage: last ? extractText(last) : "",
        timestamp: last?.messageTimestamp ? Number(last.messageTimestamp) : 0,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
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
  const canonical = canonicalJid(jid);
  const normalized: NormalizedMessage = {
    id: sent?.key.id ?? "",
    jid: canonical,
    fromMe: true,
    timestamp: Math.floor(Date.now() / 1000),
    text,
  };
  waEvents.emit("new-message", normalized);
  return normalized;
}

export async function sendImageMessage(
  jid: string,
  image: Buffer,
  caption?: string
): Promise<NormalizedMessage> {
  if (!sock) throw new Error("WhatsApp not connected");
  const sent = await sock.sendMessage(jid, { image, caption: caption || undefined });
  const canonical = canonicalJid(jid);
  const normalized: NormalizedMessage = {
    id: sent?.key.id ?? "",
    jid: canonical,
    fromMe: true,
    timestamp: Math.floor(Date.now() / 1000),
    text: caption ?? "",
    mediaType: "image",
  };
  waEvents.emit("new-message", normalized);
  return normalized;
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
  const aliasMap = buildAliasMap();
  const merged = new Map<string, NormalizedChat>();

  for (const chat of store.chats.all()) {
    const canonical = aliasMap.get(chat.id) ?? chat.id;
    const arr = store.messages[chat.id]?.array ?? [];
    const last = arr[arr.length - 1];
    const ts = last?.messageTimestamp ? Number(last.messageTimestamp) : 0;
    const lastText = last ? extractText(last) : "";
    const name = resolveDisplayName(canonical, chat.name);
    const unread = chat.unreadCount ?? 0;

    const existing = merged.get(canonical);
    if (!existing) {
      merged.set(canonical, {
        jid: canonical,
        name,
        lastMessage: lastText,
        timestamp: ts,
        unreadCount: unread,
      });
      continue;
    }

    existing.unreadCount += unread;
    if (ts > existing.timestamp) {
      existing.lastMessage = lastText;
      existing.timestamp = ts;
    }
    // Prefer a real name over a JID/phone-string fallback
    const looksLikeFallback = (n: string) =>
      n === canonical || n.startsWith("+") || n === canonical.replace(/@.*/, "");
    if (looksLikeFallback(existing.name) && !looksLikeFallback(name)) {
      existing.name = name;
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}

export function getMessages(jid: string): NormalizedMessage[] {
  const aliasMap = buildAliasMap();
  const canonical = aliasMap.get(jid) ?? jid;

  // Union every bucket whose JID canonicalizes to the same contact (handles
  // LID vs phone-JID split — messages from one person can land under two ids).
  const seen = new Set<string>();
  let arr: WAMessage[] = [];
  for (const [key, bucket] of Object.entries(store.messages)) {
    const keyCanonical = aliasMap.get(key) ?? key;
    if (keyCanonical !== canonical) continue;
    for (const m of bucket.array) {
      const id = m.key?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      arr.push(m);
    }
  }

  if (arr.length === 0) {
    // Last-resort fallback for contacts that don't have a paired lid/phone
    // entry in store.contacts yet — match by bare phone number.
    for (const [key, bucket] of Object.entries(store.messages)) {
      const contact = store.contacts[key];
      const phone = "+" + key.replace(/@.*/, "");
      if (
        contact?.notify === jid ||
        contact?.name === jid ||
        phone === jid ||
        key.replace(/@.*/, "") === jid.replace(/@.*/, "")
      ) {
        arr = bucket.array.slice();
        break;
      }
    }
  }

  arr.sort(
    (a, b) =>
      Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0)
  );

  return arr
    .slice(-50)
    .filter((m) => m.key?.id)
    .map((m) => {
      const { text, mediaType } = extractMessageContent(m);
      return {
        id: m.key.id ?? "",
        jid: canonical,
        fromMe: m.key.fromMe ?? false,
        timestamp: m.messageTimestamp ? Number(m.messageTimestamp) : 0,
        text,
        mediaType,
        pushName: m.pushName ?? undefined,
        status: m.status ?? undefined,
      };
    })
    .filter((m) => m.text || m.mediaType);
}
