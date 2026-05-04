import { Router } from "express";
import { getMessages, sendMessage } from "../whatsapp";

const router = Router();

router.get("/:jid", (req, res) => {
  const { jid } = req.params;
  res.json(getMessages(decodeURIComponent(jid)));
});

router.post("/send", async (req, res) => {
  const { jid, text } = req.body as { jid?: string; text?: string };
  if (!jid || !text) {
    res.status(400).json({ error: "jid and text are required" });
    return;
  }
  try {
    const msg = await sendMessage(jid, text);
    res.json(msg);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send";
    res.status(500).json({ error: message });
  }
});

export default router;
