import { Router } from "express";
import { getStoreStats, resetSession, startWhatsApp } from "../whatsapp";

const router = Router();

router.get("/store", (_req, res) => {
  res.json(getStoreStats());
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
