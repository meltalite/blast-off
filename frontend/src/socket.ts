import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const creds = sessionStorage.getItem("wa_creds") ?? ":";
    socket = io({
      autoConnect: true,
      extraHeaders: {
        authorization: "Basic " + btoa(creds),
      },
    });
  }
  return socket;
}

export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
}
