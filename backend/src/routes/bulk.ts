import { Router } from "express";
import { sendMessage, sendPresence, subscribePresence } from "../whatsapp";

const router = Router();

interface BulkRow {
  phone_number?: string;
  message?: string;
}

interface RowResult {
  index: number;
  phone_number: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  id?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits + "@s.whatsapp.net";
}

// Simulate a human reading the conversation, thinking, then typing.
// Roughly 4–8 chars/sec with a "thinking" lead-in. Capped so very long messages
// don't stall typing forever.
function typingDurationMs(text: string): number {
  const head = rand(1500, 3500);
  const perChar = rand(70, 130);
  return Math.min(18_000, Math.max(2500, head + text.length * perChar));
}

// Gap between finishing one message and starting the next.
// Base 10–22s, scaled up by message length, with the next message's "thinking"
// time effectively layered on top via typingDurationMs.
function postSendGapMs(prevText: string): number {
  const base = rand(10_000, 22_000);
  const lenBonus = Math.min(15_000, prevText.length * 60);
  return base + Math.floor(Math.random() * lenBonus);
}

router.post("/send", async (req, res) => {
  const { rows } = req.body as { rows?: BulkRow[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows must be a non-empty array" });
    return;
  }

  const results: RowResult[] = [];

  // Look "online" while the batch is running — same as a person opening WA.
  try { await sendPresence(undefined, "available"); } catch { /* best-effort */ }

  for (let i = 0; i < rows.length; i++) {
    const { phone_number, message } = rows[i];
    const phone = (phone_number ?? "").trim();
    const text = (message ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .trim();

    if (!phone || !text) {
      results.push({
        index: i,
        phone_number: phone,
        status: "skipped",
        error: "missing phone_number or message",
      });
      continue;
    }

    const jid = toJid(phone);

    try {
      // Subscribe to their presence first — this is what WA's official client does
      // when you open a chat. Best-effort; ignore failures.
      try { await subscribePresence(jid); } catch { /* ignore */ }
      await sleep(rand(400, 1200));

      // "typing…" indicator
      try { await sendPresence(jid, "composing"); } catch { /* ignore */ }
      await sleep(typingDurationMs(text));
      try { await sendPresence(jid, "paused"); } catch { /* ignore */ }
      // Tiny pause between releasing typing and the message landing
      await sleep(rand(200, 600));

      const sent = await sendMessage(jid, text);
      results.push({ index: i, phone_number: phone, status: "sent", id: sent.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "send failed";
      results.push({ index: i, phone_number: phone, status: "failed", error: msg });
    }

    if (i < rows.length - 1) {
      let gap = postSendGapMs(text);

      // ~12% chance of a "distracted" longer pause every message; every ~10
      // messages, force a longer break. Real users don't fire on a metronome.
      if (Math.random() < 0.12) gap += rand(30_000, 90_000);
      if ((i + 1) % rand(8, 12) === 0) gap += rand(60_000, 180_000);

      await sleep(gap);
    }
  }

  // Go "offline" when the run ends.
  try { await sendPresence(undefined, "unavailable"); } catch { /* best-effort */ }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  res.json({ total: rows.length, sent, failed, skipped, results });
});

export default router;
