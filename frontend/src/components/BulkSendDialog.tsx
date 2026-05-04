import React, { useState } from "react";

interface Props {
  authHeader: string;
  onClose: () => void;
}

interface Row {
  phone_number: string;
  message: string;
}

interface RowResult {
  index: number;
  phone_number: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

interface BulkResponse {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: RowResult[];
}

// Minimal RFC4180-ish parser. Supports quoted fields and "" escapes.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export default function BulkSendDialog({ authHeader, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<BulkResponse | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);

  const handleFile = async (file: File) => {
    setParseError(null);
    setResponse(null);
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length < 2) {
      setRows([]);
      setParseError("CSV must contain a header row and at least one data row");
      return;
    }
    const header = parsed[0].map((h) => h.trim().toLowerCase());
    const phoneIdx = header.indexOf("phone_number");
    const msgIdx = header.indexOf("message");
    if (phoneIdx === -1 || msgIdx === -1) {
      setRows([]);
      setParseError('Headers must be "phone_number" and "message"');
      return;
    }
    const normalize = (s: string) =>
      s.replace(/\r\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();
    const data: Row[] = parsed.slice(1).map((r) => ({
      phone_number: (r[phoneIdx] ?? "").trim(),
      message: normalize(r[msgIdx] ?? ""),
    }));
    setRows(data);
    setPreviewIdx(0);
  };

  const submit = async () => {
    if (rows.length === 0 || sending) return;
    setSending(true);
    setResponse(null);
    try {
      const res = await fetch("/api/bulk/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setParseError(err.error ?? "Request failed");
        return;
      }
      setResponse(await res.json());
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={sending ? undefined : onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>Bulk send via CSV</h3>
        <p style={styles.hint}>
          Upload a CSV with two columns: <code>phone_number</code> and <code>message</code>.
          Phone numbers must include country code (e.g. 6281234567890).
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          style={styles.fileInput}
          disabled={sending}
        />

        {fileName && (
          <p style={styles.fileMeta}>
            <strong>{fileName}</strong> — {rows.length} row{rows.length === 1 ? "" : "s"} ready
          </p>
        )}

        {parseError && <p style={styles.error}>{parseError}</p>}

        {rows.length > 0 && !response && (() => {
          const current = rows[previewIdx];
          return (
            <div style={styles.preview}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>phone_number</th>
                    <th style={styles.th}>message</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={styles.tdPhone}>{current.phone_number}</td>
                    <td style={styles.tdMsg}>{current.message}</td>
                  </tr>
                </tbody>
              </table>
              <div style={styles.pager}>
                <button
                  type="button"
                  style={styles.pagerBtn}
                  onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                  disabled={previewIdx === 0}
                >
                  ‹ Prev
                </button>
                <span style={styles.pagerInfo}>
                  Row {previewIdx + 1} of {rows.length}
                </span>
                <button
                  type="button"
                  style={styles.pagerBtn}
                  onClick={() => setPreviewIdx((i) => Math.min(rows.length - 1, i + 1))}
                  disabled={previewIdx >= rows.length - 1}
                >
                  Next ›
                </button>
              </div>
            </div>
          );
        })()}

        {response && (
          <div style={styles.results}>
            <p style={styles.resultsSummary}>
              Sent <strong>{response.sent}</strong>, failed <strong>{response.failed}</strong>,
              skipped <strong>{response.skipped}</strong> of {response.total}
            </p>
            <div style={styles.resultsList}>
              {response.results.map((r) => (
                <div key={r.index} style={{
                  ...styles.resultRow,
                  color: r.status === "sent" ? "#059669" : r.status === "failed" ? "#dc2626" : "#9ca3af",
                }}>
                  <span>{r.phone_number}</span>
                  <span>{r.status}{r.error ? ` — ${r.error}` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={styles.actions}>
          <button type="button" style={styles.cancel} onClick={onClose} disabled={sending}>
            {response ? "Close" : "Cancel"}
          </button>
          {!response && (
            <button
              type="button"
              style={{ ...styles.send, opacity: rows.length === 0 || sending ? 0.5 : 1 }}
              onClick={submit}
              disabled={rows.length === 0 || sending}
            >
              {sending ? `Sending… (${rows.length})` : `Send ${rows.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
  },
  dialog: {
    background: "#fff", borderRadius: 12, padding: "1.5rem",
    width: 480, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto",
    boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
  },
  title: { marginBottom: "0.5rem", color: "#128c7e", fontSize: 16 },
  hint: { fontSize: 12, color: "#6b7280", marginBottom: "0.75rem" },
  fileInput: { fontSize: 13, marginBottom: "0.5rem" },
  fileMeta: { fontSize: 12, color: "#374151", marginTop: "0.5rem" },
  error: { color: "#dc2626", fontSize: 12, marginTop: "0.5rem" },
  preview: {
    marginTop: "0.75rem", border: "1px solid #e5e7eb", borderRadius: 8,
    background: "#f9fafb", overflow: "hidden",
  },
  table: {
    width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed",
  },
  th: {
    textAlign: "left", padding: "0.5rem 0.75rem", background: "#f3f4f6",
    color: "#6b7280", fontWeight: 600, borderBottom: "1px solid #e5e7eb",
    fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em",
  },
  tdPhone: {
    padding: "0.6rem 0.75rem", verticalAlign: "top",
    fontWeight: 600, color: "#128c7e", width: 140, wordBreak: "break-all",
  },
  tdMsg: {
    padding: "0.6rem 0.75rem", verticalAlign: "top", color: "#374151",
    whiteSpace: "pre-wrap", wordBreak: "break-word",
    maxHeight: 220, overflowY: "auto",
  },
  pager: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0.4rem 0.75rem", borderTop: "1px solid #e5e7eb", background: "#fff",
  },
  pagerBtn: {
    padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid #d1d5db",
    background: "#fff", cursor: "pointer", fontSize: 12,
  },
  pagerInfo: { fontSize: 12, color: "#6b7280" },
  results: { marginTop: "0.75rem" },
  resultsSummary: { fontSize: 13, marginBottom: "0.5rem", color: "#374151" },
  resultsList: {
    border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.5rem",
    maxHeight: 220, overflowY: "auto", background: "#f9fafb",
  },
  resultRow: {
    display: "flex", justifyContent: "space-between", gap: "0.5rem",
    fontSize: 12, padding: "0.25rem 0", borderBottom: "1px solid #f3f4f6",
  },
  actions: { display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" },
  cancel: {
    padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #d1d5db",
    background: "#fff", cursor: "pointer", fontSize: 13,
  },
  send: {
    padding: "0.5rem 1rem", borderRadius: 8, border: "none",
    background: "#128c7e", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
  },
};
