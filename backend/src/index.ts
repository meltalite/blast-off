import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import basicAuth from "express-basic-auth";
import { startWhatsApp, waEvents } from "./whatsapp";
import chatsRouter from "./routes/chats";
import messagesRouter from "./routes/messages";
import adminRouter from "./routes/admin";
import mediaRouter from "./routes/media";
import bulkRouter from "./routes/bulk";

const PORT = parseInt(process.env.PORT ?? "3001");
const USER = process.env.WA_ADMIN_USER ?? "admin";
const PASS = process.env.WA_ADMIN_PASS ?? "changeme";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json({ limit: "25mb" }));

const auth = basicAuth({ users: { [USER]: PASS }, challenge: true });
app.use(auth);

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api/chats", chatsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/admin", adminRouter);
app.use("/api/media", mediaRouter);
app.use("/api/bulk", bulkRouter);

// Socket.io basic auth via handshake Authorization header
io.use((socket, next) => {
  const header = socket.handshake.headers["authorization"] ?? "";
  const b64 = header.replace(/^Basic /, "");
  const [u, p] = Buffer.from(b64, "base64").toString().split(":");
  if (u === USER && p === PASS) return next();
  next(new Error("Unauthorized"));
});

let pendingQr: string | null = null;
let currentStatus: string = "connecting";

io.on("connection", (socket) => {
  console.log("client connected", socket.id);
  // Replay current state so late-connecting clients don't miss the QR
  if (pendingQr) socket.emit("qr", pendingQr);
  socket.emit("connection-status", currentStatus);
});

waEvents.on("qr", (qr: string) => {
  pendingQr = qr;
  io.emit("qr", qr);
});
waEvents.on("connection-status", (status: string) => {
  currentStatus = status;
  if (status === "open") pendingQr = null;
  io.emit("connection-status", status);
});
waEvents.on("new-message", (msg) => io.emit("new-message", msg));
waEvents.on("chats-updated", () => io.emit("chats-updated"));
waEvents.on("message-status-update", (u) => io.emit("message-status-update", u));

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  startWhatsApp().catch(console.error);
});
