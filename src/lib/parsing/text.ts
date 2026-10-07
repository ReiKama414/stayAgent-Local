// Small text helpers shared by all parsers.

export const clean = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKC")
    .replace(/[​-‏‪-‮ ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, both: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  一: 1, 兩: 2, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

export function toNumber(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.trim().toLowerCase();
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return parseFloat(t.replace(",", "."));
  return NUM_WORDS[t] ?? null;
}

export const NUM = String.raw`(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)`;
export const ZH_NUM = String.raw`(\d+|一|兩|两|二|三|四|五|六|七|八|九|十)`;

export interface Money {
  currency: string;
  amount: number;
}

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/NT\$|TWD|新台幣|NTD/i, "TWD"],
  [/JPY|円|¥|￥|JP¥/i, "JPY"],
  [/US\$|USD/i, "USD"],
  [/HK\$|HKD/i, "HKD"],
  [/€|EUR/i, "EUR"],
  [/CN¥|RMB|CNY|人民幣/i, "CNY"],
];

/** Parse the first money amount in a string. Returns null when nothing reliable. */
export function parseMoney(text: string | null | undefined, fallbackCurrency?: string): Money | null {
  const t = clean(text);
  if (!t) return null;
  const m = t.match(
    /(NT\$|TWD|NTD|US\$|USD|HK\$|HKD|JP¥|CN¥|JPY|CNY|RMB|EUR|€|¥|￥|\$)?\s*(\d{1,3}(?:[,.\s]\d{3})+|\d+)(?:\.\d{1,2})?\s*(円|TWD|JPY|USD|元)?/,
  );
  if (!m) return null;
  const amount = parseInt(m[2].replace(/[,.\s]/g, ""), 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // an explicit currency code after the number ("$27,231 TWD") wins over a bare "$"
  const token = (m[1] && m[1] !== "$" ? m[1] : m[3] || m[1] || "").trim();
  let currency = fallbackCurrency ?? "";
  for (const [re, cur] of CURRENCY_TOKENS) {
    if (token && re.test(token)) {
      currency = cur;
      break;
    }
  }
  if (token === "$" && !currency) currency = "USD";
  if (token === "元") currency = fallbackCurrency ?? "TWD";
  if (!currency) return null;
  return { currency, amount };
}

export function allMoney(text: string, fallbackCurrency?: string): Money[] {
  const out: Money[] = [];
  const re = /(NT\$|TWD|US\$|USD|JPY|¥|￥|€|HK\$)\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?|\d{1,3}(?:,\d{3})+\s*(?:円|TWD)/g;
  for (const m of text.matchAll(re)) {
    const p = parseMoney(m[0], fallbackCurrency);
    if (p) out.push(p);
  }
  return out;
}

export function normalizeName(name: string): string {
  return clean(name)
    .toLowerCase()
    .replace(/[\(\)\[\]【】「」『』（）・,，.。'’"!！?？\-–—_/|:：&+#@]/g, " ")
    .replace(/\b(the|hotel|hotels|kyoto|japan|inn|by|stay|and|in|at|of)\b/g, " ")
    .replace(/(京都|ホテル|飯店|酒店)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, c] of A) {
    total += c;
    inter += Math.min(c, B.get(g) ?? 0);
  }
  for (const c of B.values()) total += c;
  return total ? (2 * inter) / total : 0;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function snippet(text: string, index: number, radius = 80): string {
  const s = Math.max(0, index - radius);
  const e = Math.min(text.length, index + radius);
  return (s > 0 ? "…" : "") + text.slice(s, e).replace(/\n/g, " ").trim() + (e < text.length ? "…" : "");
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(checkIn + "T00:00:00Z");
  const b = Date.parse(checkOut + "T00:00:00Z");
  return Math.max(1, Math.round((b - a) / 86400000));
}
