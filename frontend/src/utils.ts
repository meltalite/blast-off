export function formatJid(jid: string): string {
  if (jid.endsWith("@g.us")) return "Group";
  const num = jid.replace(/@.*/, "");
  if (jid.endsWith("@s.whatsapp.net")) return "+" + num;
  // LID format: show shortened version
  if (num.length > 8) return num.slice(0, 4) + "…" + num.slice(-4);
  return num;
}

/** Convert a user-entered phone number to a WhatsApp JID */
export function phoneToJid(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits + "@s.whatsapp.net";
}
