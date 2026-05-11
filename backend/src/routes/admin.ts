import { Router } from "express";
import {
  getStoreStats,
  resetSession,
  startWhatsApp,
  listAliases,
  setAlias,
  removeAlias,
  getRawChats,
} from "../whatsapp";

const router = Router();

router.get("/store", (_req, res) => {
  res.json(getStoreStats());
});

router.get("/raw-chats", (_req, res) => {
  res.json(getRawChats());
});

router.get("/aliases", (_req, res) => {
  res.json(listAliases());
});

router.post("/aliases", (req, res) => {
  const { lid, jid } = req.body as { lid?: string; jid?: string };
  if (!lid || !jid) {
    res.status(400).json({ error: "lid and jid are required" });
    return;
  }
  if (!lid.endsWith("@lid")) {
    res.status(400).json({ error: "lid must end in @lid" });
    return;
  }
  if (!jid.endsWith("@s.whatsapp.net")) {
    res.status(400).json({ error: "jid must end in @s.whatsapp.net" });
    return;
  }
  setAlias(lid, jid);
  res.json({ ok: true, aliases: listAliases() });
});

router.delete("/aliases/:lid", (req, res) => {
  removeAlias(decodeURIComponent(req.params.lid));
  res.json({ ok: true, aliases: listAliases() });
});

router.post("/reset-session", async (_req, res) => {
  try {
    await resetSession();
    // Restart the WhatsApp connection so a new QR is generated
    setTimeout(() => startWhatsApp().catch(console.error), 1000);
    res.json({ ok: true, message: "Session cleared. A new QR will appear in the app." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    res.status(500).json({ error: message });
  }
});

export default router;
