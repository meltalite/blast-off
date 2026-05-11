import { Router } from "express";
import { getMessages, sendMessage, sendImageMessage } from "../whatsapp";

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

router.post("/send-image", async (req, res) => {
  const { jid, caption, imageBase64 } = req.body as {
    jid?: string;
    caption?: string;
    imageBase64?: string;
  };
  if (!jid || !imageBase64) {
    res.status(400).json({ error: "jid and imageBase64 are required" });
    return;
  }
  try {
    const data = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(data, "base64");
    const msg = await sendImageMessage(jid, buffer, caption);
    res.json(msg);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send";
    res.status(500).json({ error: message });
  }
});

export default router;
