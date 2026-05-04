import React, { useState } from "react";

interface Props {
  onLogin: (user: string, pass: string) => void;
  error?: string;
}

export default function LoginScreen({ onLogin, error }: Props) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(user, pass);
  };

  return (
    <div style={styles.wrap}>
      <form onSubmit={submit} style={styles.card}>
        <h2 style={styles.title}>Mila Studio WA</h2>
        {error && <p style={styles.error}>{error}</p>}
        <input
          style={styles.input}
          placeholder="Username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="username"
        />
        <input
          style={styles.input}
          type="password"
          placeholder="Password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete="current-password"
        />
        <button style={styles.btn} type="submit">
          Sign in
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "#f0f2f5",
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    width: 320,
    boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
  },
  title: {
    textAlign: "center",
    color: "#128c7e",
    marginBottom: "0.5rem",
  },
  input: {
    padding: "0.6rem 0.8rem",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 14,
    outline: "none",
  },
  btn: {
    padding: "0.7rem",
    borderRadius: 8,
    border: "none",
    background: "#128c7e",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
  },
  error: {
    color: "#dc2626",
    fontSize: 13,
    textAlign: "center",
  },
};
