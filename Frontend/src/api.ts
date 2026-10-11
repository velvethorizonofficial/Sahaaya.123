/// <reference types="vite/client" />
// SAHAAYA frontend ↔ backend integration contract.

export type Lang = "en" | "hi" | "te";
export const LANG_CODE: Record<string, Lang> = { English: "en", Hindi: "hi", Telugu: "te" };
export const langName = (l: Lang) => Object.keys(LANG_CODE).find(k => LANG_CODE[k] === l)!;
export const SPEEDS = [0.75, 1, 1.25, 1.5];
export const SPEED_LABELS = ["Slow", "Comfortable", "Fast", "Faster"];
export const STAFF_LANG: Lang = (import.meta.env.VITE_STAFF_LANG as Lang) || "en";
export const TABLE = 12;

// Empty fallback routes relatively on Vercel multi-service setups
const HTTP = typeof window !== "undefined"
  ? ((import.meta.env.VITE_API_URL as string) || "").replace(/\/$/, "")
  : "";

const WS = typeof window !== "undefined"
  ? (HTTP ? HTTP.replace(/^http/, "ws") : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`)
  : "";

/** Demo-drawer switches. `offline` blocks all calls; `flags` go to the server as X-Sim. */
export const sim = { offline: false, flags: new Set<string>() };

export type ApiError = { code: string; retryable: boolean; userMessage: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const uid = (): string =>
  (globalThis.crypto && "randomUUID" in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const sessionId = (() => {
  try {
    let s = sessionStorage.getItem("sahaaya.sid");
    if (!s) { s = uid(); sessionStorage.setItem("sahaaya.sid", s); }
    return s;
  } catch { return uid(); }
})();

async function toError(res: Response): Promise<ApiError> {
  try {
    const b = await res.json();
    const e = b?.error ?? b;
    if (e && typeof e.code === "string") {
      return { code: e.code, retryable: !!e.retryable, userMessage: e.userMessage ?? "Something went wrong. Please try again." };
    }
  } catch { /* not JSON */ }
  const retryable = res.status >= 500 || res.status === 429;
  return {
    code: `http_${res.status}`, retryable,
    userMessage: retryable ? "The service is busy. Please try again." : "That didn’t work. Please try again.",
  };
}

type Opts = RequestInit & { timeoutMs?: number; retries?: number };

/** Fetch with timeout, exponential-backoff retries on retryable errors, and normalized errors. */
async function request<T>(path: string, init: Opts = {}): Promise<T> {
  const { timeoutMs = 25000, retries = 1, headers, ...rest } = init;
  if (sim.offline) throw { code: "offline", retryable: false, userMessage: "You’re offline. Please reconnect and try again." } satisfies ApiError;
  let last: ApiError = { code: "unknown", retryable: false, userMessage: "Something went wrong." };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const h: Record<string, string> = { "X-Session-Id": sessionId, ...(headers as Record<string, string>) };
      if (sim.flags.size) h["X-Sim"] = [...sim.flags].join(",");
      const res = await fetch(HTTP + path, { ...rest, headers: h, signal: ctl.signal });
      if (res.ok) {
        const json = res.headers.get("content-type")?.includes("json");
        return (json ? await res.json() : await res.blob()) as T;
      }
      last = await toError(res);
    } catch (e) {
      last = {
        code: (e as Error).name === "AbortError" ? "timeout" : "network", retryable: true,
        userMessage: "Couldn’t reach the server. Please try again.",
      };
    } finally { clearTimeout(timer); }
    if (!last.retryable || attempt === retries) break;
    await sleep(400 * 2 ** attempt);
  }
  throw last;
}

const post = <T>(path: string, body: unknown, o: Opts = {}) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...o });
const upload = <T>(path: string, fd: FormData, o: Opts = {}) => request<T>(path, { method: "POST", body: fd, ...o });

/* ───────────── Health ───────────── */
export const health = () => request<Record<string, unknown>>("/health", { retries: 0, timeoutMs: 6000 });

/* ───────────── ASR ───────────── */
export type AsrResult = { text: string; confidence: number; lang: Lang; lowConfidence: boolean };
export async function asr(audio: Blob, lang: Lang): Promise<AsrResult> {
  const fd = new FormData();
  fd.append("audio", audio, `speech.${audio.type.includes("mp4") ? "m4a" : audio.type.includes("wav") ? "wav" : "webm"}`);
  fd.append("lang", lang);
  const r = await upload<Partial<AsrResult>>("/api/asr", fd, { timeoutMs: 25000 });
  const confidence = r.confidence ?? 1;
  const text = (r.text ?? "").trim();
  return { text, confidence, lang: r.lang ?? lang, lowConfidence: r.lowConfidence ?? (!text || confidence < 0.6) };
}

/* ───────────── MT ───────────── */
const mtCache = new Map<string, string>();
export async function mt(texts: string[], source: Lang, target: Lang): Promise<string[]> {
  if (source === target) return texts;
  const key = (t: string) => `${source}>${target}|${t}`;
  const miss = [...new Set(texts.filter(t => !mtCache.has(key(t))))];
  if (miss.length) {
    const r = await post<{ translations: string[] }>("/api/mt", { texts: miss, source, target });
    miss.forEach((t, i) => mtCache.set(key(t), r.translations[i] ?? t));
  }
  return texts.map(t => mtCache.get(key(t)) ?? t);
}

/* ───────────── TTS ───────────── */
const ttsCache = new Map<string, string>();
export async function tts(text: string, lang: Lang, speed = 1): Promise<string> {
  const key = `${lang}|${speed}|${text}`;
  const hit = ttsCache.get(key);
  if (hit) return hit;
  const r = await post<Blob | { audioUrl?: string; audioContent?: string }>("/api/tts", { text, lang, language: lang, speed }, { timeoutMs: 6000, retries: 0 });
  if (r instanceof Blob) {
    const url = URL.createObjectURL(r);
    ttsCache.set(key, url);
    return url;
  }
  if (r?.audioContent) {
    const url = `data:audio/wav;base64,${r.audioContent}`;
    ttsCache.set(key, url);
    return url;
  }
  if (r?.audioUrl) {
    const url = r.audioUrl.startsWith("http") ? r.audioUrl : HTTP + r.audioUrl;
    ttsCache.set(key, url);
    return url;
  }
  throw new Error("No audio returned");
}

/* ───────────── Menu ───────────── */
export type MenuItem = {
  name: string; price?: number | null; description?: string;
  veg?: boolean | null; diet?: "veg" | "nonveg" | "vegan" | "egg"; jain?: boolean | null;
  spice?: number | null; allergens?: string[]; confidence?: number;
};
export type ParsedMenu = { sections: { name: string; items: MenuItem[] }[]; unclear?: unknown[] };
const unwrapMenu = (r: { menu?: ParsedMenu } & Partial<ParsedMenu>) => (r.menu ?? r) as ParsedMenu;

export async function parseMenu(image: File, lang: Lang): Promise<ParsedMenu> {
  const fd = new FormData();
  fd.append("image", image);
  fd.append("lang", lang);
  return unwrapMenu(await upload("/api/menu/parse", fd, { timeoutMs: 50000 }));
}

export async function sampleMenu(id = "1"): Promise<ParsedMenu> {
  return unwrapMenu(await request(`/api/menu/sample/${id}`));
}

export async function translateMenuDishes(dishes: any[], targetLang: Lang): Promise<any[]> {
  if (targetLang === "en" || !dishes?.length) return dishes;
  try {
    const res = await post<{ dishes: any[] }>("/api/menu/translate", { dishes, targetLang }, { timeoutMs: 15000, retries: 1 });
    return res.dishes || dishes;
  } catch {
    return dishes;
  }
}

/* ───────────── Bill ───────────── */
export type BillData = { lines: { name: string; qty: number; price: number }[]; taxPct: number; serviceCharge: number; billedTotal: number };
type Raw = Record<string, any>;
export async function parseBill(image: File): Promise<BillData> {
  const fd = new FormData();
  fd.append("image", image);
  const r = await upload<Raw>("/api/bill/parse", fd, { timeoutMs: 50000 });
  const lines = ((r.lines ?? []) as Raw[]).map(l => {
    const qty = Number(l.qty ?? 1) || 1;
    return { name: String(l.name ?? ""), qty, price: Number(l.price ?? (l.amount != null ? l.amount / qty : 0)) };
  }).filter(l => l.name);
  if (!lines.length) throw { code: "bill_unreadable", retryable: false, userMessage: "I couldn’t read any items. Try a clearer, well-lit photo." } satisfies ApiError;
  const sub = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const tax = Number(r.taxTotal ?? r.tax ?? 0);
  return {
    lines,
    taxPct: Number(r.taxPct ?? (sub ? Math.round((tax / sub) * 1000) / 10 : 0)),
    serviceCharge: Number(r.serviceCharge ?? 0),
    billedTotal: Number(r.total ?? r.billedTotal ?? 0),
  };
}

/* ───────────── Explain & Describe ───────────── */
export async function explainSimpler(text: string, lang: Lang): Promise<string> {
  return (await post<{ text: string }>("/api/explain", { text, lang })).text;
}

export type TableData = { columns: string[]; rows: string[][] };
export async function describe(kind: "table" | "chart" | "code", data: unknown, lang: Lang): Promise<string> {
  return (await post<{ text: string }>("/api/describe", { kind, data, lang })).text;
}

/* ───────────── WebSocket Relay ───────────── */
export type RelayType = "order" | "waiter_call" | "staff_reply" | "bill_request" | "alert" | "caption" | "guest_text" | "phrase";
export type RelayMsg = {
  id: string; type: RelayType; table: number; from: "guest" | "staff";
  text?: string; lang?: Lang; phraseId?: string; audioUrl?: string; ts: number;
};

export function openRelay(o: {
  table: number; role: "guest" | "staff"; lang: Lang;
  onMessage: (m: RelayMsg) => void; onStatus: (online: boolean) => void;
}) {
  let wsClient: WebSocket | undefined;
  let closed = false, tries = 0, lastTs = 0, timer: number | undefined;
  const queue: RelayMsg[] = [];

  const schedule = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = window.setTimeout(connect, Math.min(1000 * 2 ** tries++, 15000));
  };

  function connect() {
    if (closed || !WS) return;
    wsClient = new WebSocket(`${WS}/relay?table=${o.table}&role=${o.role}&lang=${o.lang}&since=${lastTs}`);
    wsClient.onopen = () => { tries = 0; o.onStatus(true); while (queue.length) wsClient!.send(JSON.stringify(queue.shift())); };
    wsClient.onmessage = e => {
      try { const m = JSON.parse(e.data) as RelayMsg; lastTs = Math.max(lastTs, m.ts ?? 0); o.onMessage(m); } catch { /* ignore bad frame */ }
    };
    wsClient.onclose = () => { o.onStatus(false); schedule(); };
    wsClient.onerror = () => wsClient?.close();
  }
  connect();

  return {
    send(m: RelayMsg) { if (wsClient?.readyState === WebSocket.OPEN) wsClient.send(JSON.stringify(m)); else queue.push(m); },
    close() { closed = true; clearTimeout(timer); wsClient?.close(); },
  };
}
