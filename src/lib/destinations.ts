import { romaji } from "./transit";
import { CITY_IDS } from "./destination-ids";

/**
 * Destination catalogue. `query` is what is typed into Booking / Airbnb.
 * Agoda / Trip.com city ids live in destination-ids.ts and only contain ids verified live
 * (the site's own result page names the city). Without an id the site's search box is used and
 * the result page is checked to be the same city.
 */
export interface Destination {
  query: string;
  en: string;
  zh: string;
  ja: string;
  country: string;
  region: Region;
  aliases?: string[];
}

export type Region =
  | "hokkaido"
  | "tohoku"
  | "kanto"
  | "chubu"
  | "kansai"
  | "chugoku"
  | "shikoku"
  | "kyushu"
  | "okinawa"
  | "taiwan"
  | "korea"
  | "asia";

export const REGION_LABEL: Record<Region, [en: string, zh: string, ja: string]> = {
  hokkaido: ["Hokkaido", "北海道", "北海道"],
  tohoku: ["Tohoku", "東北", "東北"],
  kanto: ["Kanto", "關東", "関東"],
  chubu: ["Chubu", "中部", "中部"],
  kansai: ["Kansai", "關西", "関西"],
  chugoku: ["Chugoku", "中國地方", "中国"],
  shikoku: ["Shikoku", "四國", "四国"],
  kyushu: ["Kyushu", "九州", "九州"],
  okinawa: ["Okinawa", "沖繩", "沖縄"],
  taiwan: ["Taiwan", "台灣", "台湾"],
  korea: ["Korea", "韓國", "韓国"],
  asia: ["Other Asia", "其他亞洲", "その他アジア"],
};

type Row = [query: string, zh: string, ja: string, region: Region, aliases?: string[]];

const JP: Row[] = [
  // Hokkaido
  ["Sapporo", "札幌", "札幌", "hokkaido", ["さっぽろ"]],
  ["Otaru", "小樽", "小樽", "hokkaido", ["おたる"]],
  ["Hakodate", "函館", "函館", "hokkaido", ["はこだて"]],
  ["Asahikawa", "旭川", "旭川", "hokkaido"],
  ["Furano", "富良野", "富良野", "hokkaido"],
  ["Biei", "美瑛", "美瑛", "hokkaido"],
  ["Niseko", "二世古", "ニセコ", "hokkaido", ["新雪谷"]],
  ["Noboribetsu", "登別", "登別", "hokkaido"],
  ["Kushiro", "釧路", "釧路", "hokkaido"],
  ["Obihiro", "帶廣", "帯広", "hokkaido"],
  // Tohoku
  ["Aomori", "青森", "青森", "tohoku"],
  ["Hirosaki", "弘前", "弘前", "tohoku"],
  ["Morioka", "盛岡", "盛岡", "tohoku"],
  ["Sendai", "仙台", "仙台", "tohoku"],
  ["Matsushima", "松島", "松島", "tohoku"],
  ["Akita", "秋田", "秋田", "tohoku"],
  ["Kakunodate", "角館", "角館", "tohoku"],
  ["Yamagata", "山形", "山形", "tohoku"],
  ["Zao", "藏王", "蔵王", "tohoku"],
  ["Ginzan Onsen", "銀山溫泉", "銀山温泉", "tohoku"],
  ["Fukushima", "福島", "福島", "tohoku"],
  ["Aizuwakamatsu", "會津若松", "会津若松", "tohoku", ["Aizu"]],
  // Kanto
  ["Tokyo", "東京", "東京", "kanto", ["とうきょう", "东京"]],
  ["Shinjuku", "新宿", "新宿", "kanto"],
  ["Shibuya", "澀谷", "渋谷", "kanto", ["渋谷"]],
  ["Asakusa", "淺草", "浅草", "kanto", ["浅草"]],
  ["Ginza", "銀座", "銀座", "kanto"],
  ["Ueno", "上野", "上野", "kanto"],
  ["Ikebukuro", "池袋", "池袋", "kanto"],
  ["Yokohama", "橫濱", "横浜", "kanto", ["横滨"]],
  ["Kamakura", "鎌倉", "鎌倉", "kanto"],
  ["Hakone", "箱根", "箱根", "kanto"],
  ["Nikko", "日光", "日光", "kanto"],
  ["Kusatsu", "草津", "草津", "kanto", ["草津温泉"]],
  ["Chiba", "千葉", "千葉", "kanto"],
  ["Narita", "成田", "成田", "kanto"],
  ["Urayasu", "浦安(迪士尼)", "浦安", "kanto", ["Tokyo Disney", "迪士尼"]],
  ["Saitama", "埼玉", "さいたま", "kanto"],
  ["Kawagoe", "川越", "川越", "kanto"],
  ["Mito", "水戶", "水戸", "kanto"],
  ["Utsunomiya", "宇都宮", "宇都宮", "kanto"],
  ["Takasaki", "高崎", "高崎", "kanto"],
  // Chubu
  ["Nagoya", "名古屋", "名古屋", "chubu"],
  ["Kanazawa", "金澤", "金沢", "chubu", ["金泽"]],
  ["Takayama", "高山", "高山", "chubu", ["飛騨高山"]],
  ["Shirakawa", "白川鄉", "白川郷", "chubu", ["Shirakawa-go"]],
  ["Toyama", "富山", "富山", "chubu"],
  ["Fukui", "福井", "福井", "chubu"],
  ["Matsumoto", "松本", "松本", "chubu"],
  ["Nagano", "長野", "長野", "chubu"],
  ["Karuizawa", "輕井澤", "軽井沢", "chubu", ["轻井泽"]],
  ["Hakuba", "白馬", "白馬", "chubu"],
  ["Fujikawaguchiko", "河口湖", "河口湖", "chubu", ["Kawaguchiko", "富士河口湖"]],
  ["Kofu", "甲府", "甲府", "chubu"],
  ["Shizuoka", "靜岡", "静岡", "chubu"],
  ["Atami", "熱海", "熱海", "chubu"],
  ["Ito", "伊東", "伊東", "chubu", ["伊豆"]],
  ["Niigata", "新潟", "新潟", "chubu"],
  ["Gifu", "岐阜", "岐阜", "chubu"],
  ["Gero", "下呂", "下呂", "chubu", ["下呂温泉"]],
  // Kansai
  ["Kyoto", "京都", "京都", "kansai", ["きょうと", "kyōto"]],
  ["Osaka", "大阪", "大阪", "kansai", ["おおさか", "ōsaka"]],
  ["Namba", "難波", "なんば", "kansai", ["難波", "Nanba"]],
  ["Umeda", "梅田", "梅田", "kansai"],
  ["Nara", "奈良", "奈良", "kansai", ["なら"]],
  ["Kobe", "神戶", "神戸", "kansai", ["こうべ", "神户", "kōbe"]],
  ["Arima Onsen", "有馬溫泉", "有馬温泉", "kansai"],
  ["Himeji", "姬路", "姫路", "kansai"],
  ["Uji", "宇治", "宇治", "kansai"],
  ["Otsu", "大津", "大津", "kansai"],
  ["Wakayama", "和歌山", "和歌山", "kansai"],
  ["Shirahama", "白濱", "白浜", "kansai"],
  ["Koyasan", "高野山", "高野山", "kansai"],
  ["Ise", "伊勢", "伊勢", "kansai"],
  ["Kinosaki", "城崎溫泉", "城崎温泉", "kansai"],
  // Chugoku
  ["Hiroshima", "廣島", "広島", "chugoku", ["广岛"]],
  ["Miyajima", "宮島", "宮島", "chugoku", ["Hatsukaichi"]],
  ["Okayama", "岡山", "岡山", "chugoku"],
  ["Kurashiki", "倉敷", "倉敷", "chugoku"],
  ["Tottori", "鳥取", "鳥取", "chugoku"],
  ["Matsue", "松江", "松江", "chugoku"],
  ["Izumo", "出雲", "出雲", "chugoku"],
  ["Yamaguchi", "山口", "山口", "chugoku"],
  ["Shimonoseki", "下關", "下関", "chugoku"],
  // Shikoku
  ["Takamatsu", "高松", "高松", "shikoku"],
  ["Naoshima", "直島", "直島", "shikoku"],
  ["Matsuyama", "松山", "松山", "shikoku", ["道後温泉"]],
  ["Kochi", "高知", "高知", "shikoku"],
  ["Tokushima", "德島", "徳島", "shikoku"],
  // Kyushu
  ["Fukuoka", "福岡", "福岡", "kyushu", ["ふくおか", "福冈", "Hakata", "博多"]],
  ["Kitakyushu", "北九州", "北九州", "kyushu"],
  ["Dazaifu", "太宰府", "太宰府", "kyushu"],
  ["Saga", "佐賀", "佐賀", "kyushu"],
  ["Ureshino", "嬉野", "嬉野", "kyushu"],
  ["Nagasaki", "長崎", "長崎", "kyushu"],
  ["Sasebo", "佐世保(豪斯登堡)", "佐世保", "kyushu", ["Huis Ten Bosch", "豪斯登堡"]],
  ["Kumamoto", "熊本", "熊本", "kyushu"],
  ["Aso", "阿蘇", "阿蘇", "kyushu"],
  ["Kurokawa Onsen", "黑川溫泉", "黒川温泉", "kyushu"],
  ["Oita", "大分", "大分", "kyushu"],
  ["Beppu", "別府", "別府", "kyushu"],
  ["Yufuin", "由布院", "由布院", "kyushu", ["湯布院", "Yufu"]],
  ["Miyazaki", "宮崎", "宮崎", "kyushu"],
  ["Takachiho", "高千穗", "高千穂", "kyushu"],
  ["Kagoshima", "鹿兒島", "鹿児島", "kyushu"],
  ["Ibusuki", "指宿", "指宿", "kyushu"],
  ["Yakushima", "屋久島", "屋久島", "kyushu"],
  // Okinawa
  ["Naha", "那霸", "那覇", "okinawa", ["Okinawa", "沖繩", "沖縄"]],
  ["Onna", "恩納", "恩納村", "okinawa"],
  ["Chatan", "北谷", "北谷", "okinawa"],
  ["Motobu", "本部(美麗海)", "本部", "okinawa"],
  ["Ishigaki", "石垣島", "石垣島", "okinawa", ["石垣"]],
  ["Miyakojima", "宮古島", "宮古島", "okinawa"],
];

const WORLD: Row[] = [
  ["Taipei", "台北", "台北", "taiwan", ["臺北"]],
  ["Taichung", "台中", "台中", "taiwan", ["臺中"]],
  ["Tainan", "台南", "台南", "taiwan", ["臺南"]],
  ["Kaohsiung", "高雄", "高雄", "taiwan"],
  ["Hualien", "花蓮", "花蓮", "taiwan"],
  ["Yilan", "宜蘭", "宜蘭", "taiwan"],
  ["Seoul", "首爾", "ソウル", "korea"],
  ["Busan", "釜山", "釜山", "korea"],
  ["Jeju", "濟州", "済州", "korea"],
  ["Bangkok", "曼谷", "バンコク", "asia"],
  ["Chiang Mai", "清邁", "チェンマイ", "asia"],
  ["Singapore", "新加坡", "シンガポール", "asia"],
  ["Hong Kong", "香港", "香港", "asia"],
];

const COUNTRY: Partial<Record<Region, string>> = { taiwan: "Taiwan", korea: "South Korea" };

export const DESTINATIONS: Destination[] = [...JP, ...WORLD].map(([query, zh, ja, region, aliases]) => ({
  query,
  en: query,
  zh,
  ja,
  region,
  country: region === "asia" ? "" : COUNTRY[region] ?? "Japan",
  aliases,
}));

/** Chips shown under the destination box */
export const QUICK_PICKS = ["Kyoto", "Osaka", "Tokyo", "Nara", "Kobe", "Fukuoka", "Sapporo", "Naha"];

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s,、・()（）]/g, "")
    .replace(/(市|city|japan|日本)$/g, "");

export function findDestination(input: string): (Destination & { agoda?: string; trip?: string }) | null {
  const n = norm(input);
  if (!n) return null;
  const d = DESTINATIONS.find((x) => [x.query, x.zh, x.ja, ...(x.aliases ?? [])].some((v) => norm(v) === n));
  return d ? { ...d, ...CITY_IDS[d.query] } : null;
}

/** Text to type into a site's search box: English name for known places, otherwise the user's input. */
export function destinationQuery(input: string): string {
  return findDestination(input)?.query ?? input.trim();
}

/** "Nara City" vs "Nara", "Ōsaka" vs "Osaka" */
export function sameCity(shown: string, wanted: string): boolean {
  const a = romaji(shown).replace(/(city|shi)$/, "");
  const b = romaji(wanted).replace(/(city|shi)$/, "");
  return !!a && !!b && (a.includes(b) || b.includes(a));
}
