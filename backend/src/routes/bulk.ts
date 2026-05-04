import { Router } from "express";
import { sendMessage } from "../whatsapp";

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

function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits + "@s.whatsapp.net";
}

router.post("/send", async (req, res) => {
  const { rows } = req.body as { rows?: BulkRow[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows must be a non-empty array" });
    return;
  }

  const results: RowResult[] = [];
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

    try {
      const sent = await sendMessage(toJid(phone), text);
      results.push({ index: i, phone_number: phone, status: "sent", id: sent.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "send failed";
      results.push({ index: i, phone_number: phone, status: "failed", error: msg });
    }

    // throttle to reduce risk of WhatsApp flagging the account
    if (i < rows.length - 1) await sleep(1200);
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  res.json({ total: rows.length, sent, failed, skipped, results });
});

export default router;
