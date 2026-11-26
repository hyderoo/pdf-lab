/** Accepts "5.25", "05.250", "1:05.250", "01:02:05.250". Returns seconds or null. */
export function parseTime(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!/^\d+(\.\d+)?$/.test(parts[i])) return null;
    if (i < parts.length - 1 && parts[i].includes(".")) return null;
    total = total * 60 + parseFloat(parts[i]);
  }
  return total;
}

export function formatTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${h > 0 ? p(h) + ":" : ""}${p(m)}:${p(s)}.${p(r, 3)}`;
}
