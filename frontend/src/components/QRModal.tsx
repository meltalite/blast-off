import { QRCodeSVG } from "qrcode.react";

interface Props {
  qr: string;
}

export default function QRModal({ qr }: Props) {
  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <h3 style={styles.title}>Scan with WhatsApp</h3>
        <p style={styles.sub}>
          Open WhatsApp → Linked Devices → Link a Device
        </p>
        <QRCodeSVG value={qr} size={256} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: "#128c7e",
  },
  sub: {
    fontSize: 13,
    color: "#6b7280",
    textAlign: "center",
  },
};
