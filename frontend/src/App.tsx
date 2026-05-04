import { useEffect, useState } from "react";
import LoginScreen from "./components/LoginScreen";
import QRModal from "./components/QRModal";
import ChatList from "./components/ChatList";
import ChatWindow from "./components/ChatWindow";
import { getSocket, resetSocket } from "./socket";

type ConnStatus = "connecting" | "open" | "close" | null;

export default function App() {
  const [authHeader, setAuthHeader] = useState<string | null>(() => {
    const saved = sessionStorage.getItem("wa_creds");
    return saved ? "Basic " + btoa(saved) : null;
  });
  const [loginError, setLoginError] = useState<string | undefined>();
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>(null);
  const [resetting, setResetting] = useState(false);

  const handleRescan = async () => {
    if (!authHeader || resetting) return;
    setResetting(true);
    try {
      await fetch("/api/admin/reset-session", {
        method: "POST",
        headers: { Authorization: authHeader },
      });
      // QR modal will appear automatically via socket event
    } finally {
      setResetting(false);
    }
  };

  const handleLogin = async (user: string, pass: string) => {
    const header = "Basic " + btoa(`${user}:${pass}`);
    try {
      const res = await fetch("/api/chats", { headers: { Authorization: header } });
      if (res.status === 401) {
        setLoginError("Invalid credentials");
        return;
      }
      sessionStorage.setItem("wa_creds", `${user}:${pass}`);
      setAuthHeader(header);
      setLoginError(undefined);
    } catch {
      setLoginError("Could not reach server");
    }
  };

  useEffect(() => {
    if (!authHeader) return;

    const socket = getSocket();

    socket.on("qr", (data: string) => setQr(data));
    socket.on("connection-status", (status: ConnStatus) => {
      setConnStatus(status);
      if (status === "open") setQr(null);
    });

    socket.on("connect_error", () => {
      sessionStorage.removeItem("wa_creds");
      resetSocket();
      setAuthHeader(null);
      setLoginError("Session expired. Please sign in again.");
    });

    return () => {
      socket.off("qr");
      socket.off("connection-status");
      socket.off("connect_error");
    };
  }, [authHeader]);

  if (!authHeader) {
    return <LoginScreen onLogin={handleLogin} error={loginError} />;
  }

  return (
    <div style={styles.root}>
      {qr && <QRModal qr={qr} />}
      <div style={styles.statusBar}>
        <span style={styles.logo}>Mila Studio WA</span>
        <span style={{ ...styles.dot, background: connStatus === "open" ? "#22c55e" : connStatus === "connecting" ? "#f59e0b" : "#ef4444" }} />
        <span style={styles.statusText}>
          {connStatus === "open" ? "Connected" : connStatus === "connecting" ? "Connecting…" : "Disconnected"}
        </span>
        <button
          style={{ ...styles.rescanBtn, opacity: resetting ? 0.6 : 1 }}
          onClick={handleRescan}
          disabled={resetting}
          title="Re-scan QR / re-link device"
        >
          {resetting ? "…" : "Re-scan QR"}
        </button>
      </div>
      <div style={styles.main}>
        <ChatList
          selectedJid={selectedJid}
          onSelect={(jid, name) => { setSelectedJid(jid); setSelectedName(name ?? null); }}
          authHeader={authHeader}
        />
        <ChatWindow jid={selectedJid} name={selectedName} authHeader={authHeader} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
  },
  statusBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 1rem",
    background: "#128c7e",
    color: "#fff",
  },
  logo: { fontWeight: 700, fontSize: 15, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  statusText: { fontSize: 13 },
  rescanBtn: {
    marginLeft: "0.75rem",
    padding: "0.25rem 0.75rem",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.5)",
    background: "transparent",
    color: "#fff",
    fontSize: 12,
    cursor: "pointer",
  },
  main: { display: "flex", flex: 1, overflow: "hidden" },
};
