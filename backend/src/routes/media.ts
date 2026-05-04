import { Router } from "express";
import { getRawMessage, downloadMediaMessage } from "../whatsapp";

const router = Router();

router.get("/:jid/:msgId", async (req, res) => {
  const { jid, msgId } = req.params;
  const msg = getRawMessage(decodeURIComponent(jid), msgId);
  if (!msg?.message) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const c = msg.message;
    let mime = "application/octet-stream";
    if (c.imageMessage?.mimetype) mime = c.imageMessage.mimetype;
    else if (c.videoMessage?.mimetype) mime = c.videoMessage.mimetype;
    else if (c.audioMessage?.mimetype) mime = c.audioMessage.mimetype;
    else if (c.documentMessage?.mimetype) mime = c.documentMessage.mimetype;

    const stream = await downloadMediaMessage(msg, "stream", {});
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    (stream as NodeJS.ReadableStream).pipe(res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    res.status(500).json({ error: message });
  }
});

export default router;
