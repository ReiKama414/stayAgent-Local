import type { Lang } from "./i18n-dict";

/** Display-time translation of generated explanation lines (sleeping plan, trust reasons). Site text is never translated. */
const BEDS: Record<string, [string, string]> = {
  singles: ["張單人床", "シングル"],
  single: ["單人床", "シングル"],
  "semi-double": ["小雙人床", "セミダブル"],
  double: ["雙人床", "ダブル"],
  queen: ["Queen 床", "クイーン"],
  king: ["King 床", "キング"],
  futon: ["日式床墊", "布団"],
  tatami: ["榻榻米", "畳"],
  sofa: ["沙發床", "ソファベッド"],
  bunk: ["雙層床", "二段ベッド"],
};

export function explainLine(s: string, lang: Lang): string {
  if (lang === "en") return s;
  const zh = lang === "zh";
  const bed = (x: string) =>
    x.replace(/\b(\d+)?\s*(singles|single|semi-double|double|queen|king|futon|tatami|sofa|bunk)\b/g, (_m, n, b) => `${n ? n + " " : ""}${BEDS[b][zh ? 0 : 1]}`).replace(/no suitable bed/, zh ? "沒有合適的床" : "適したベッドなし").replace(/no accepted bed/, zh ? "沒有可睡的床" : "寝具なし").replace(/no separate bedroom with a suitable bed/, zh ? "沒有獨立臥室" : "別の寝室なし");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^Couple (\d+): (.*)$/))) return zh ? `第 ${m[1]} 對:${bed(m[2])}` : `${m[1]} 組目:${bed(m[2])}`;
  if ((m = s.match(/^Guest (\d+): (.*)$/))) return zh ? `第 ${m[1]} 人:${bed(m[2])}` : `${m[1]} 人目:${bed(m[2])}`;
  if ((m = s.match(/^(only )?(\d+) reviews$/))) return zh ? `${m[1] ? "只有 " : ""}${m[2]} 則評論` : `レビュー${m[1] ? "わずか" : ""} ${m[2]} 件`;
  if (s === "review count unknown") return zh ? "評論數不明" : "レビュー数不明";
  if ((m = s.match(/^rating ([\d.]+\/\d+)( \(below 8\/10\))?$/))) return zh ? `評分 ${m[1]}${m[2] ? "(低於 8/10)" : ""}` : `評価 ${m[1]}${m[2] ? "(8/10 未満)" : ""}`;
  if ((m = s.match(/^listed on (\d+) platforms$/))) return zh ? `在 ${m[1]} 個平台上架` : `${m[1]} サイトに掲載`;
  if ((m = s.match(/^(\d+) years hosting$/))) return zh ? `經營 ${m[1]} 年` : `ホスト歴 ${m[1]} 年`;
  if ((m = s.match(/^host has ([\d,]+) reviews$/))) return zh ? `房東共有 ${m[1]} 則評論` : `ホストのレビュー ${m[1]} 件`;
  if ((m = s.match(/^legal registration(?: found)?: (.*)$/))) return zh ? `有合法登記:${m[1]}` : `届出・許可あり:${m[1]}`;
  if ((m = s.match(/^host company score ([\d.]+) \(([\d,]+) reviews\)$/))) return zh ? `管理公司評分 ${m[1]}(${m[2]} 則)` : `管理会社の評価 ${m[1]}(${m[2]} 件)`;
  const fixed: Record<string, [string, string]> = {
    Superhost: ["超讚房東", "スーパーホスト"],
    "Airbnb Guest Favorite": ["Airbnb 旅客最愛", "Airbnb ゲストのお気に入り"],
    "Booking Preferred Partner": ["Booking 優選合作夥伴", "Booking 推奨パートナー"],
    "Agoda Preferred": ["Agoda 優選", "Agoda Preferred"],
    "bed configuration unknown": ["床位配置不明", "ベッド構成不明"],
  };
  if (fixed[s]) return fixed[s][zh ? 0 : 1];
  if (/^per-bedroom bed layout not stated/.test(s)) return zh ? "沒有標示每間臥室的床位,無法確認情侶是否各自一間" : "寝室ごとのベッド配置の記載がなく、別室か確認できません";
  return s;
}
