import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { LANG_CODE, SPEED_LABELS, STAFF_LANG, TABLE, describe, explainSimpler, health, langName, mt, parseBill, parseMenu, sampleMenu, sim, translateMenuDishes } from "./api";
import type { ApiError, Lang, ParsedMenu, TableData } from "./api";
import { useListen, useRelay, useSpeech } from "./hooks";
import { getPageAnnouncement, welcomeSequence, type Screen } from "./pageSpeech";
type Persona = "Default" | "Blind" | "Deaf" | "Non-speaking" | "Elderly" | "Hand-motor";
type IconName = "hand" | "sound" | "settings" | "spark" | "repeat" | "slow" | "simple" | "back" | "waiter" | "mic" | "type" | "phrases" | "camera" | "upload" | "menu" | "check" | "leaf" | "fire" | "plus" | "minus" | "arrow" | "close" | "wifi" | "alert" | "contrast" | "eye" | "rupee" | "copy" | "receipt";

const iconPaths: Record<IconName, React.ReactNode> = {
  hand: <><path d="M7 13V7a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v5c0 5-3 8-8 8-3 0-5-2-7-5l-2-3a1.5 1.5 0 0 1 2-2l3 3Z" /></>,
  sound: <><path d="m11 5-5 4H2v6h4l5 4V5ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15a2 2 0 0 0 .4 2l-2.8 2.8a2 2 0 0 0-2-.4A2 2 0 0 0 13 21h-4a2 2 0 0 0-1.5-1.6 2 2 0 0 0-2 .4L2.8 17a2 2 0 0 0 .4-2A2 2 0 0 0 2 13V9a2 2 0 0 0 1.2-1.5 2 2 0 0 0-.4-2L5.5 2.8a2 2 0 0 0 2 .4A2 2 0 0 0 9 2h4a2 2 0 0 0 1.5 1.2 2 2 0 0 0 2-.4l2.7 2.7a2 2 0 0 0-.4 2A2 2 0 0 0 20 9v4a2 2 0 0 0-1 2Z" /></>,
  spark: <path d="m12 2 1.4 5L18 9l-4.6 2L12 16l-1.4-5L6 9l4.6-2L12 2ZM5 15l.7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15Z" />,
  repeat: <><path d="m4 7 3-3v6L4 7ZM7 7h8a5 5 0 0 1 0 10H8" /></>,
  slow: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
  simple: <path d="M4 6h16M4 12h11M4 18h7" />,
  back: <path d="m15 18-6-6 6-6" />,
  waiter: <path d="M4 15h16M6 15a6 6 0 0 1 12 0M12 6V4M3 20h18" />,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
  type: <path d="M5 6V4h14v2M12 4v16M8 20h8" />,
  phrases: <path d="M4 5h16v12H8l-4 4V5ZM8 9h8M8 13h5" />,
  camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3V7Z" /><circle cx="12" cy="13" r="4" /></>,
  upload: <path d="M12 16V4m0 0L7 9m5-5 5 5M4 18v2h16v-2" />,
  menu: <path d="M4 5h16M4 12h16M4 19h16" />,
  check: <path d="m5 12 4 4L19 6" />,
  leaf: <path d="M20 4C10 4 5 9 6 16c1 3 3 4 3 4 1-7 5-10 11-16ZM8 20c2-6 6-10 12-16" />,
  fire: <path d="M13 3s1 4-2 7c-2-2-3-3-3-3s-4 5-1 10a6 6 0 0 0 10 0c3-5-4-14-4-14Z" />,
  plus: <path d="M12 5v14M5 12h14" />, minus: <path d="M5 12h14" />, arrow: <path d="m9 18 6-6-6-6" />, close: <path d="m6 6 12 12M18 6 6 18" />,
  wifi: <path d="M3 9a14 14 0 0 1 18 0M7 13a8 8 0 0 1 10 0M10 17a3 3 0 0 1 4 0M12 20h.01" />,
  alert: <path d="M12 3 2.5 20h19L12 3ZM12 9v5M12 17h.01" />,
  contrast: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" /></>,
  rupee: <path d="M6 4h12M6 9h12M6 4c6 0 8 2 8 5s-3 5-8 5l8 6" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></>,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" />,
  eye: <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
};
function Icon({ name, size = 22 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{iconPaths[name]}</svg>; }
function Button({ children, icon, onClick, variant = "primary", className = "", style }: { children: React.ReactNode; icon?: IconName; onClick?: () => void; variant?: "primary" | "secondary" | "ghost"; className?: string; style?: React.CSSProperties }) { return <button onClick={onClick} style={style} className={`button ${variant} ${className}`}>{icon && <Icon name={icon} />}<span>{children}</span></button>; }
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? "small" : ""}`}>
      <img src="/logo.png" alt="SAHAAYA Logo" className="logo-mark" />
      <strong>SAHAAYA</strong>
    </div>
  );
}

type Prefs = { diet: string[]; spice: string; avoid: string[] };
const defaultPrefs: Prefs = { diet: [], spice: "Any", avoid: [] };
type Diet = "veg" | "nonveg" | "vegan" | "egg" | "unknown";
type Dish = { name: string; desc: string; price: number; img: string; diet: Diet; jain: boolean; spice: number; allergens: string[]; allergensKnown?: boolean };

type MenuStats = { items: number; sections: number; unclear: number };
type AppCtx = {
  inLang: Lang; outLang: Lang; setLangs: (i: Lang, o: Lang) => void; speedIdx: number; setSpeedIdx: (n: number) => void; notify: (x: string) => void;
  say: (english: string) => Promise<void>; explain: (text: string) => Promise<void>; simpler: () => Promise<void>; describeTable: (d: TableData) => Promise<void>;
  play: (text: string, lang?: Lang) => Promise<void>; replay: () => void; toStaff: (text: string, phraseId?: string, from?: Lang) => Promise<void>;
  heard: string | null; setHeard: (t: string | null) => void; reply: string | null; setLow: (b: boolean) => void;
  relay: ReturnType<typeof useRelay>; loadMenu: (f: File | null) => Promise<boolean>; menuStats: MenuStats | null;
  mic: "idle" | "listening" | "processing"; toggle: () => void; startListening: () => void; stopListening: () => void; openKeypad: () => void;
  dishes: Dish[];
};
const AppContext = createContext<AppCtx>(null as unknown as AppCtx);
const useApp = () => useContext(AppContext);

const journey: Screen[] = ["start", "language", "entry", "scan", "ready", "preferences", "explore", "order", "staff", "bill", "payment", "feedback"];
const stage: Record<Screen, number> = { start: 0, language: 0, entry: 0, scan: 0, ready: 0, preferences: 1, explore: 2, order: 3, staff: 3, phrases: 3, bill: 4, payment: 5, feedback: 5 };
const stageNames = ["Scan", "Preferences", "Explore", "My picks", "Bill", "Pay"];

function Header({ screen, settings, demo }: { screen: Screen; settings: () => void; demo: () => void }) {
  return <header className="header"><div className="header-row"><Logo small /><div><button className="icon-button" onClick={settings} aria-label="Accessibility settings"><Icon name="settings" /></button><button className="icon-button saffron" onClick={demo} aria-label="Demo controls"><Icon name="spark" /></button></div></div></header>;
}

function KeypadModal({ open, close, onSubmit }: { open: boolean; close: () => void; onSubmit: (val: string) => void }) {
  const [val, setVal] = useState("");
  if (!open) return null;
  return (
    <div className="backdrop" onMouseDown={close}>
      <section className="confirm" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <span className="confirm-icon"><Icon name="type" size={28} /></span>
        <span className="eyebrow">KEYBOARD INPUT</span>
        <h2>Type your choice</h2>
        <p>Type your selection or voice command using the keypad:</p>
        <form onSubmit={e => { e.preventDefault(); if (val.trim()) { onSubmit(val.trim()); setVal(""); close(); } }}>
          <input
            autoFocus
            style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "2px solid var(--p)", marginBottom: "14px", fontSize: "17px", boxSizing: "border-box" }}
            placeholder="e.g. English, Veg, Next, Paneer..."
            value={val}
            onChange={e => setVal(e.target.value)}
          />
          <Button variant="primary" className="wide">Submit choice</Button>
          <Button variant="secondary" onClick={close} className="wide" style={{ marginTop: "8px" }}>Cancel</Button>
        </form>
      </section>
    </div>
  );
}

function AlwaysBar({ back, call, notify }: { back: () => void; call: () => void; notify: (x: string) => void }) {
  const { replay, simpler, speedIdx, setSpeedIdx } = useApp();
  const slower = () => { if (speedIdx === 0) { notify("Already at the slowest speed"); return } setSpeedIdx(speedIdx - 1); notify(`Speech speed: ${SPEED_LABELS[speedIdx - 1]}`) };
  const a: [IconName, string, () => void][] = [["repeat", "Repeat", () => replay()], ["slow", "Slower", slower], ["simple", "Simpler", () => simpler()], ["back", "Back", back], ["waiter", "Call waiter", call]];
  return <nav className="always" aria-label="Always available actions">{a.map(([i, l, f]) => <button key={l} onClick={f}><Icon name={i} /><span>{l}</span></button>)}</nav>;
}
function Conversation({ user = "I’d like vegetarian food.", system = "Here are 8 vegetarian choices." }: { user?: string; system?: string }) { const { heard, reply } = useApp(); user = heard ?? user; system = reply ?? system; return <section className="conversation" aria-live="polite"><span className="user"><Icon name="sound" size={15} />{user}</span><span><Icon name="sound" size={15} />{system}</span></section>; }
function InputDock({ phrases, notify, warning = false, onHeard, onKeypad }: { phrases: () => void; notify: (x: string) => void; warning?: boolean; onHeard?: (t: string) => void; onKeypad?: () => void }) {
  const { heard, mic, toggle, openKeypad } = useApp();
  const handleKeypad = onKeypad ?? openKeypad;
  return <section className="dock">{warning && <div className="did-you"><Icon name="alert" size={17} />{heard ? <><strong>Did you mean:</strong> “{heard}”?</> : <strong>I didn’t catch that. Speak again, or tap Keypad to type.</strong>}</div>}<div><button onClick={handleKeypad} title="Type with keyboard"><Icon name="type" /><small>Keypad</small></button><button onClick={toggle} className={`mic ${mic}`} aria-pressed={mic === "listening"}><Icon name="mic" size={29} /><strong>{mic === "idle" ? "Speak" : mic === "listening" ? "Listening" : "Thinking"}</strong><small>{mic === "listening" ? "Tap or Keypad" : "Tap"}</small></button><button onClick={phrases}><Icon name="phrases" /><small>Phrases</small></button></div></section>;
}
function Start({ next, settings, demo }: { next: () => void; settings: () => void; demo: () => void }) {
  const { setLangs } = useApp(); const pick = (l: Lang) => { setLangs(l, l); next() };
  return <main className="start"><div className="glow one" /><div className="glow two" /><div className="start-top"><button onClick={settings}><Icon name="settings" size={18} />Accessibility</button></div><div className="start-center"><Logo /><p className="tagline">Every Need, Every Voice, Every Me</p><div className="greeting"><span className="sound-orb"><Icon name="sound" /></span><span><small>Welcome</small><strong>भोजन के लिए तैयार?</strong><small>Ready to dine?</small></span></div><Button onClick={next} icon="hand" className="wide begin">Tap or press Space to begin</Button><div className="languages"><button onClick={() => pick("en")}>English</button><button onClick={() => pick("hi")}>हिन्दी</button><button onClick={() => pick("te")}>తెలుగు</button></div></div><p className="privacy"><Icon name="eye" size={17} />No download. Preferences stay on this device.</p><button onClick={demo} className="demo-fab"><Icon name="spark" />Demo</button></main>;
}
function Language({ next, onKeypad }: { next: () => void; onKeypad?: () => void }) {
  const { inLang, outLang, setLangs, say } = useApp(); const a = langName(inLang), b = langName(outLang);
  const setA = (x: string) => setLangs(LANG_CODE[x], outLang), setB = (x: string) => setLangs(inLang, LANG_CODE[x]);
  const Select = ({ title, value, set }: { title: string; value: string; set: (x: string) => void }) => <section className="language-set"><span className="eyebrow">{title === "I understand" ? "STEP 1 · INPUT" : "STEP 2 · OUTPUT"}</span><h2>{title}</h2><div>{[["English", "English"], ["Hindi", "हिन्दी"], ["Telugu", "తెలుగు"]].map(([x, n]) => <button key={x} onClick={() => set(x)} className={value === x ? "selected" : ""}><strong>{n}</strong><small>{x}</small>{value === x && <i><Icon name="check" size={15} /></i>}</button>)}</div></section>;
  return <main className="setup"><div className="title"><span className="eyebrow">LET’S SET UP YOUR EXPERIENCE</span><h1>How would you like to talk?</h1><p>Say your language or choose below.</p></div><Select title="I understand" value={a} set={setA} /><Select title="Speak to me in" value={b} set={setB} /><div className="preview"><Icon name="sound" /><span><strong>Preview</strong><small>“Your menu is ready.”</small></span><button aria-label="Play preview" onClick={() => say("Your menu is ready.")}><Icon name="sound" /></button></div><Button onClick={next} icon="arrow" className="wide">Continue</Button>{onKeypad && <Button onClick={onKeypad} icon="type" variant="secondary" className="wide" style={{ marginTop: "8px" }}>Type with Keypad</Button>}</main>;
}
function Entry({ go }: { go: (s: Screen) => void }) {
  const { loadMenu, notify, openKeypad } = useApp(); const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const read = async (f: File | null) => { setBusy(true); const ok = await loadMenu(f); setBusy(false); if (ok) go("ready") };
  const opts: [IconName, string, string, () => void][] = [["camera", "Take a photo", "Use camera to photograph the menu", () => go("scan")], ["upload", "Upload an image", "Choose a menu image or PDF from device", () => input.current?.click()], ["menu", "Try sample menu", "Explore with our built-in sample menu", () => read(null)]];
  return <><main className="content"><input ref={input} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) read(f) }} /><div className="title"><span className="eyebrow">LET’S BEGIN</span><h1>How do you want to read the menu?</h1><p>We’ll parse it using Bhaasha OCR so it’s easy to explore.</p></div>{busy && <div className="note success" role="status"><Icon name="menu" /><span><strong>Reading your menu with Bhaasha OCR…</strong><small>Extracting dishes, prices and ingredients</small></span></div>}<div className="entry-list">{opts.map(([i, t, d, act], n) => <button key={t} disabled={busy} onClick={act} className={n === 0 ? "featured" : ""}>{n === 0 && <em>RECOMMENDED</em>}<span className="option-icon"><Icon name={i} /></span><span><strong>{t}</strong><small>{d}</small></span><Icon name="arrow" /></button>)}</div><div className="note success"><Icon name="eye" /><span><strong>Your menu stays private</strong><small>Photos are processed securely and not saved.</small></span></div></main><Conversation user="I’m ready to read the menu." system="Choose how you’d like to begin." /><InputDock phrases={() => go("phrases")} notify={notify} onKeypad={openKeypad} /></>;
}
function Scan({ next }: { next: () => void }) {
  const { loadMenu } = useApp(); const input = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { console.warn("Live camera needs https or localhost"); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; v.play().catch(() => { }); setCameraActive(true); }
      })
      .catch(err => console.warn("Camera access:", err));
    return () => { cancelled = true; stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  const capture = async () => {
    if (videoRef.current && videoRef.current.videoWidth) {
      setBusy(true);
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(videoRef.current, 0, 0);
      canvas.toBlob(async blob => {
        if (blob) {
          const file = new File([blob], "camera-menu.jpg", { type: "image/jpeg" });
          const ok = await loadMenu(file);
          if (ok) next(); else setBusy(false);
        } else {
          setBusy(false);
        }
      }, "image/jpeg", 0.9);
      return;
    }
    input.current?.click();
  };

  const onFile = async (f?: File) => { if (!f) return; setBusy(true); const ok = await loadMenu(f); if (ok) next(); else setBusy(false); };

  return <main className="content scan"><input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={e => onFile(e.target.files?.[0])} /><div className="title"><span className="eyebrow">SCAN MENU</span><h1>Hold still, I’ll guide you</h1></div><div className="viewfinder"><video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraActive ? "block" : "none" }} />{!cameraActive && <img src="https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=75" alt="Menu through camera" />}<i /><i /><i /><i /><b>LIVE</b><div><Icon name="alert" /><span><strong>{cameraActive ? "Camera active" : "Position camera"}</strong><small>Point steadily at the printed menu</small></span></div></div><div className="quality"><span><i />Brightness <b>Good</b></span><span><i />Focus <b>Good</b></span></div><Button onClick={capture} icon="camera" className="wide">{busy ? "Extracting menu with Bhaasha OCR…" : "Capture menu"}</Button><button className="text-link" onClick={() => input.current?.click()}><Icon name="upload" />Or choose image from device</button></main>;
}
const spiceLabel = ["Not spicy", "Mild", "Medium", "Hot", "Spice not stated"];
const IMG1 = "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=500&q=75", IMG2 = "https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=500&q=75";
const demoDishes: Dish[] = [
  { name: "Palak paneer", desc: "Cottage cheese in a mild spinach sauce", price: 320, img: IMG1, diet: "veg", jain: false, spice: 1, allergens: ["Dairy"] },
  { name: "Vegetable biryani", desc: "Fragrant rice, vegetables and warm spices", price: 280, img: IMG2, diet: "veg", jain: false, spice: 2, allergens: [] },
  { name: "Dal tadka", desc: "Yellow lentils with cumin and garlic", price: 240, img: IMG1, diet: "vegan", jain: false, spice: 1, allergens: [] },
  { name: "Jain dal fry", desc: "Lentils tempered with asafoetida, no onion or garlic", price: 230, img: IMG1, diet: "vegan", jain: true, spice: 1, allergens: [] },
  { name: "Jain paneer butter masala", desc: "Creamy tomato gravy without onion or garlic", price: 340, img: IMG2, diet: "veg", jain: true, spice: 1, allergens: ["Dairy", "Nuts"] },
  { name: "Chana masala", desc: "Chickpeas in a tangy, spiced gravy", price: 250, img: IMG2, diet: "vegan", jain: false, spice: 3, allergens: [] },
  { name: "Egg curry", desc: "Boiled eggs in a rich onion-tomato gravy", price: 260, img: IMG1, diet: "egg", jain: false, spice: 2, allergens: ["Egg"] },
  { name: "Butter chicken", desc: "Tandoori chicken in a creamy tomato gravy", price: 380, img: IMG2, diet: "nonveg", jain: false, spice: 1, allergens: ["Dairy", "Nuts"] },
  { name: "Chicken biryani", desc: "Basmati rice layered with spiced chicken", price: 360, img: IMG1, diet: "nonveg", jain: false, spice: 3, allergens: [] },
];
let dishes: Dish[] = demoDishes;
const setDishesGlobal = (d: Dish[]) => { dishes = d; };
const menuToDishes = (m: ParsedMenu): Dish[] => m.sections.flatMap(s => s.items).filter(i => i.name).map(i => ({ name: i.name, desc: i.description ?? "", price: i.price ?? 0, img: "", diet: i.diet ?? (i.veg === true ? "veg" : i.veg === false ? "nonveg" : "unknown"), jain: i.jain === true, spice: typeof i.spice === "number" ? Math.min(3, Math.max(0, Math.round(i.spice))) : 4, allergens: i.allergens ?? [], allergensKnown: Array.isArray(i.allergens) }));
const dietTag = (d: Dish) => d.diet === "unknown" ? "Diet not stated" : d.diet === "nonveg" ? "Non-veg" : d.diet === "egg" ? "Egg" : d.diet === "vegan" ? "Vegan" : "Veg";
function matches(d: Dish, p: Prefs) {
  const base = p.diet.filter(x => ["Veg", "Non-veg", "Eggetarian"].includes(x));
  const okBase = base.length === 0 || base.some(x => x === "Veg" ? (d.diet === "veg" || d.diet === "vegan") : x === "Eggetarian" ? (d.diet === "veg" || d.diet === "vegan" || d.diet === "egg") : true);
  const okVegan = !p.diet.includes("Vegan") || d.diet === "vegan";
  const okJain = !p.diet.includes("Jain") || d.jain;
  const maxSpice = p.spice === "Less spicy" ? 1 : p.spice === "Medium" ? 2 : p.spice === "Hot" ? 3 : 4;
  return okBase && okVegan && okJain && d.spice <= maxSpice && !d.allergens.some(a => p.avoid.includes(a)) && !(p.avoid.length > 0 && d.allergensKnown === false);
}
const prefSummary = (p: Prefs) => [...p.diet, ...(p.spice !== "Any" ? [p.spice] : []), ...p.avoid.map(a => `No ${a.toLowerCase()}`)];
const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pickLines = (cart: Record<string, number>, currentDishes: Dish[] = dishes) => currentDishes.filter(d => (cart[d.name] || 0) > 0).map(d => ({ name: d.name, qty: cart[d.name], price: d.price }));

function Ready({ next, retake }: { next: () => void; retake: () => void }) {
  const { menuStats, dishes: currentDishes, say } = useApp();
  const m = menuStats ?? { items: currentDishes.length, sections: 1, unclear: 0 };
  return <main className="content ready"><span className="success-mark"><Icon name="check" size={34} /></span><span className="eyebrow">MENU READY</span><h1>I found {m.items} items</h1><p>Organised into {m.sections} section{m.sections === 1 ? "" : "s"} so they’re easier to explore.</p><div className="summary"><span><strong>{m.items}</strong><small>items</small></span><span><strong>{m.sections}</strong><small>sections</small></span><span><strong>{m.unclear}</strong><small>prices unclear</small></span></div><div className="read-card"><span className="option-icon"><Icon name="sound" /></span><span><strong>Here’s what I found</strong><small>Tap to hear a short summary.</small></span><button onClick={() => say(`I found ${m.items} items in ${m.sections} sections.${m.unclear ? ` ${m.unclear} prices need a quick check.` : ""}`)}>Read aloud</button></div>{m.unclear > 0 && <div className="note warning"><Icon name="alert" /><span><strong>{m.unclear} price{m.unclear === 1 ? "" : "s"} need a quick check</strong><small>You can still explore now and fix them later.</small></span></div>}<Button onClick={next} icon="arrow" className="wide">Set my preferences</Button><Button onClick={retake} icon="camera" variant="secondary" className="wide">Retake photo</Button></main>;
}
function Preferences({ prefs, setPrefs, next }: { prefs: Prefs; setPrefs: (p: Prefs) => void; next: () => void }) {
  const { dishes: currentDishes } = useApp();
  const toggle = (list: string[], x: string) => list.includes(x) ? list.filter(y => y !== x) : [...list, x];
  const count = currentDishes.filter(d => matches(d, prefs)).length;
  const diets: [string, IconName][] = [["Veg", "leaf"], ["Non-veg", "fire"], ["Jain", "leaf"], ["Vegan", "leaf"], ["Eggetarian", "leaf"]];
  return <><main className="content prefs"><div className="title"><span className="eyebrow">YOUR PREFERENCES</span><h1>What suits you today?</h1><p>SAHAAYA will filter and highlight dishes from your menu. You’ll still order with the waiter yourself.</p></div>
    <section className="pref-group"><h2>Food type</h2><p>Pick all that apply</p><div className="pref-chips">{diets.map(([x, i]) => <button key={x} aria-pressed={prefs.diet.includes(x)} className={prefs.diet.includes(x) ? "selected" : ""} onClick={() => setPrefs({ ...prefs, diet: toggle(prefs.diet, x) })}><Icon name={i} size={16} />{x}</button>)}</div></section>
    <section className="pref-group"><h2>Spice level</h2><div className="pref-chips">{["Any", "Less spicy", "Medium", "Hot"].map(x => <button key={x} aria-pressed={prefs.spice === x} className={prefs.spice === x ? "selected" : ""} onClick={() => setPrefs({ ...prefs, spice: x })}>{x === "Hot" ? "Spicy is fine" : x}</button>)}</div></section>
    <section className="pref-group"><h2>Avoid</h2><p>Optional allergens or ingredients</p><div className="pref-chips">{["Nuts", "Dairy", "Egg", "Gluten"].map(x => <button key={x} aria-pressed={prefs.avoid.includes(x)} className={prefs.avoid.includes(x) ? "selected" : ""} onClick={() => setPrefs({ ...prefs, avoid: toggle(prefs.avoid, x) })}>{x}</button>)}</div></section>
    <div className="note success"><Icon name="check" /><span><strong>{count} of {currentDishes.length} dishes match</strong><small>{prefSummary(prefs).join(" · ") || "No filters — showing everything"}</small></span></div>
    <div className="note warning"><Icon name="alert" /><span><strong>Always confirm with staff</strong><small>Menu analysis can miss hidden ingredients. For allergies, ask the waiter.</small></span></div>
    <Button onClick={next} icon="arrow" className="wide">Show matching dishes</Button><button className="text-link" onClick={() => setPrefs(defaultPrefs)}>Clear all</button></main><Conversation user="Show me suitable dishes." system={`${count} dishes match your preferences.`} /></>;
}

function Explore({ go, cart, setCart, notify, prefs }: { go: (s: Screen) => void; cart: Record<string, number>; setCart: (c: Record<string, number>) => void; notify: (x: string) => void; prefs: Prefs }) {
  const { dishes: currentDishes, say, explain, describeTable } = useApp();
  const [compare, setCompare] = useState(false);
  const list = currentDishes.filter(d => matches(d, prefs)); const picked = pickLines(cart, currentDishes); const count = picked.reduce((n, l) => n + l.qty, 0); const total = picked.reduce((n, l) => n + l.qty * l.price, 0);
  const chips = prefSummary(prefs);
  const describeDish = (d: Dish) => say(`${d.name}, ${d.price > 0 ? money(d.price) : "price unclear"}. ${d.desc}. ${dietTag(d)}. ${spiceLabel[d.spice]}. ${d.allergensKnown === false ? "Allergens are not stated. Please confirm with staff." : d.allergens.length ? `Contains ${d.allergens.join(", ")}. Please confirm allergens with staff.` : "No allergens are listed. Please confirm with staff."}`);
  const narrate = () => describeTable({ columns: ["Dish", "Price", "Spice", "Diet"], rows: list.slice(0, 2).map(d => [d.name, money(d.price), spiceLabel[d.spice], dietTag(d)]) });
  return <><main className="content explore"><div className="explore-head"><div><span className="eyebrow">{list.length} CHOICES</span><h1>Dishes for you</h1></div><button onClick={() => setCompare(!compare)} disabled={list.length < 2}><Icon name="contrast" />Compare</button></div><div className="chips">{chips.length ? chips.map(x => <button key={x} className="selected" onClick={() => go("preferences")}>{x}</button>) : <button onClick={() => go("preferences")}>No filters</button>}<button onClick={() => go("preferences")}>Edit preferences</button></div>
    {compare && list.length >= 2 && <div className="compare"><span><small>{list[0].name.toUpperCase()}</small><strong>{list[0].name}</strong><em>{money(list[0].price)} · {spiceLabel[list[0].spice]}</em></span><b>vs</b><span><small>{list[1].name.toUpperCase()}</small><strong>{list[1].name}</strong><em>{money(list[1].price)} · {spiceLabel[list[1].spice]}</em></span></div>}{compare && list.length >= 2 && <Button onClick={narrate} icon="sound" variant="secondary" className="wide">Hear the comparison</Button>}
    {list.length === 0 && <div className="note warning"><Icon name="alert" /><span><strong>No dishes match all your preferences</strong><small>Try relaxing a filter, or ask the waiter what can be adapted.</small></span></div>}
    <div className="dishes">{list.map(d => { const q = cart[d.name] || 0; return <article key={d.name}>{d.img && <img src={d.img} alt={d.name} />}<div><header><h2>{d.name}</h2><strong>{d.price > 0 ? money(d.price) : "Price unclear"}</strong></header><p>{d.desc}</p><div className="tags"><span><Icon name="leaf" size={14} />{dietTag(d)}</span>{d.jain && <span><Icon name="check" size={14} />Jain</span>}<span><Icon name="fire" size={14} />{spiceLabel[d.spice]}</span></div>{d.allergensKnown === false ? <small className="allergen">Allergens not stated. Ask staff.</small> : d.allergens.length > 0 && <small className="allergen">Contains: {d.allergens.join(", ")}</small>}<div className="dish-tools"><button onClick={() => explain(d.desc)}><Icon name="simple" size={17} />Explain simpler</button><button onClick={() => describeDish(d)}><Icon name="sound" size={17} />Describe</button></div><Button onClick={() => { setCart({ ...cart, [d.name]: q ? 0 : 1 }); notify(q ? `${d.name} removed from picks` : `${d.name} saved to your picks`) }} icon={q ? "check" : "plus"} variant={q ? "secondary" : "primary"} className="wide">{q ? "In my picks · tap to remove" : "Add to my picks"}</Button></div></article> })}</div></main><Conversation user={chips.length ? `I’d like: ${chips.join(", ")}.` : "Show me everything."} system={`Here are ${list.length} choices.`} /><InputDock phrases={() => go("phrases")} notify={notify} />{count > 0 && <button className="floating-cart" onClick={() => go("order")}><i>{count}</i><strong>View my picks</strong><span>{money(total)}</span><Icon name="arrow" /></button>}</>;
}
function Confirm({ title, detail, yes, no, label = "Yes, confirm", left, right }: { title: string; detail: string; yes: () => void; no: () => void; label?: string; left?: string; right?: string }) { return <div className="backdrop"><section className="confirm" role="dialog" aria-modal="true"><span className="confirm-icon"><Icon name="check" size={30} /></span><span className="eyebrow">ONE LAST CHECK</span><h2>{title}</h2><p>{detail}</p>{left && <div><span>{left}</span><strong>{right}</strong></div>}<Button onClick={yes} icon="check" className="wide">{label}</Button><Button onClick={no} icon="back" variant="secondary" className="wide">Change</Button><small>Enter to confirm · Esc to go back</small></section></div>; }
function Order({ go, cart, setCart }: { go: (s: Screen) => void; cart: Record<string, number>; setCart: (c: Record<string, number>) => void }) {
  const { dishes: currentDishes } = useApp();
  const [modal, setModal] = useState(false); const lines = pickLines(cart, currentDishes); const total = lines.reduce((n, l) => n + l.qty * l.price, 0); const count = lines.reduce((n, l) => n + l.qty, 0);
  const set = (name: string, q: number) => setCart({ ...cart, [name]: Math.max(0, q) });
  return <main className="content"><div className="title"><span className="eyebrow">MY PICKS</span><h1>Your shortlist</h1><p>Adjust quantities, then tell the waiter your order. SAHAAYA doesn’t place orders for you.</p></div>
    {lines.length === 0 ? <div className="note warning"><Icon name="alert" /><span><strong>No dishes picked yet</strong><small>Go back to the menu and tap “Add to my picks”.</small></span></div> : <div className="cart">{lines.map(l => { const d = currentDishes.find(x => x.name === l.name); return <article key={l.name}><span><strong>{l.name}</strong><small>{d ? `${dietTag(d)} · ${spiceLabel[d.spice]}` : ""}</small></span><div className="stepper"><button onClick={() => set(l.name, l.qty - 1)} aria-label={`Fewer ${l.name}`}><Icon name="minus" /></button><b>{l.qty}</b><button onClick={() => set(l.name, l.qty + 1)} aria-label={`More ${l.name}`}><Icon name="plus" /></button></div><strong>{money(l.price * l.qty)}</strong></article> })}</div>}
    <div className="total"><span><small>Estimated subtotal</small><small>Taxes and charges appear on your bill</small></span><strong>{money(total)}</strong></div>
    <Button onClick={() => count > 0 ? setModal(true) : go("explore")} icon={count > 0 ? "check" : "back"} className="wide">{count > 0 ? "Save my picks" : "Back to dishes"}</Button><p className="safe"><Icon name="waiter" size={18} />Nothing is sent. You order manually with your waiter.</p>
    {modal && <Confirm title="Save these picks?" detail="Use this list when you order. Later you can upload your bill to cross-check it." left={`${count} item${count > 1 ? "s" : ""}`} right={money(total)} label="Yes, save and continue" no={() => setModal(false)} yes={() => go("staff")} />}</main>;
}
function StaffChat({ go, deaf }: { go: (s: Screen) => void; deaf: boolean }) {
  const { relay, play, outLang, inLang, notify } = useApp(); const rev = [...relay.msgs].reverse();
  const staff = rev.find(m => m.from === "staff" && !!m.text && m.type !== "alert"), alertMsg = rev.find(m => m.from === "staff" && m.type === "alert" && !!m.text), mine = rev.find(m => m.from === "guest" && !!m.text);
  return <><main className="content chat">{deaf && alertMsg && <div className="visual-alert"><Icon name="alert" /><span><strong>Order update</strong><small>{alertMsg.text}</small></span></div>}<div className="title"><span className="eyebrow">TABLE {TABLE} · LIVE</span><h1>Talk with your waiter</h1><p>Speech appears here as live captions.</p></div><div className="caption"><header><span>AR</span><div><strong>Arun · Your waiter</strong><small>{!relay.online ? "Reconnecting…" : staff ? "Latest message" : "Waiting for your waiter"}</small></div></header><blockquote>{staff ? `“${staff.text}”` : "Messages from your waiter will appear here as captions."}</blockquote><footer><span>LIVE CAPTION</span><button disabled={!staff} onClick={() => staff && play(staff.text!, staff.lang ?? outLang)}><Icon name="sound" size={16} />Replay</button></footer></div>{mine && <div className="reply"><small>You</small><p>{mine.text}</p><Icon name="check" size={16} /></div>}<button className="phrase-link" onClick={() => go("phrases")}><span className="option-icon"><Icon name="phrases" /></span><span><strong>Use a quick phrase</strong><small>Tap a phrase and we’ll speak it aloud</small></span><Icon name="arrow" /></button><Button onClick={() => go("bill")} icon="arrow" className="wide">I’ve finished eating · Check my bill</Button></main><Conversation user={mine?.text ?? "Say or type a message for your waiter."} system={staff?.text ?? "Waiting for your waiter."} /><InputDock phrases={() => go("phrases")} notify={notify} onHeard={t => relay.send("guest_text", { text: t, lang: inLang })} /></>;
}
function Phrases({ back }: { back: () => void; notify: (x: string) => void }) {
  const { toStaff, inLang } = useApp(); const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const phrases = ["Water please", "Less spicy", "Bill please", "I am allergic to nuts", "Call the manager", "Please give me a moment"]; const slug = (p: string) => p.toLowerCase().replace(/\W+/g, "_");
  const sendTyped = async () => { if (!msg.trim()) return; setBusy(true); await toStaff(msg.trim(), undefined, inLang); setBusy(false); setMsg("") };
  return <main className="content"><div className="title"><span className="eyebrow">SPEAK TO STAFF</span><h1>Quick phrases</h1><p>Tap one and SAHAAYA will say it aloud.</p></div><div className="phrase-grid">{phrases.map((p, i) => <button key={p} className={i === 3 ? "danger" : ""} onClick={() => toStaff(p, slug(p))}><Icon name={i === 3 ? "alert" : "sound"} /><strong>{p}</strong><small>Tap to speak</small></button>)}</div><label className="free-text"><span>Or type your own</span><textarea rows={3} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Type a message for staff…" /></label><Button onClick={sendTyped} icon="sound" variant="secondary" className="wide">{busy ? "Sending…" : "Say it and send to staff"}</Button><Button onClick={back} icon="back" variant="secondary" className="wide">Back to conversation</Button></main>;
}
type BillLine = { name: string; qty: number; price: number };
type Bill = { lines: BillLine[]; taxPct: number; serviceCharge: number; billedTotal: number };
type Finding = { level: "error" | "warn" | "ok"; title: string; detail: string };
const TAX_PCT = 5;
// Sample-bill generator (demo only). Real uploads go through parseBill() in api.ts.
function extractBill(picks: BillLine[]): Bill {
  const base = picks.length ? picks : [{ name: "Palak paneer", qty: 1, price: 320 }, { name: "Vegetable biryani", qty: 1, price: 280 }];
  const lines = base.map((l, i) => i === 0 ? { ...l, qty: l.qty + 1 } : l); lines.push({ name: "Packaged water", qty: 1, price: 40 });
  const sub = lines.reduce((n, l) => n + l.qty * l.price, 0); const service = Math.round(sub * 0.1);
  return { lines, taxPct: TAX_PCT, serviceCharge: service, billedTotal: Math.round(sub + service + sub * TAX_PCT / 100) + 20 };
}
function crosscheck(bill: Bill, picks: BillLine[], currentDishes: Dish[] = dishes): { findings: Finding[]; correct: number } {
  const f: Finding[] = []; const sub = bill.lines.reduce((n, l) => n + l.qty * l.price, 0); let adj = 0;
  bill.lines.forEach(l => {
    const p = picks.find(x => x.name === l.name); const menu = currentDishes.find(d => d.name === l.name);
    if (!p && !menu) f.push({ level: "warn", title: `“${l.name}” wasn’t on your picks`, detail: `Billed ${money(l.price * l.qty)}. Fine if you ordered it — otherwise ask the waiter.` });
    else if (p && l.qty > p.qty) { f.push({ level: "error", title: `${l.name}: billed ×${l.qty}, you picked ×${p.qty}`, detail: `Possible extra charge of ${money((l.qty - p.qty) * l.price)}.` }); adj += (l.qty - p.qty) * l.price; }
    else if (!p && menu) { f.push({ level: "warn", title: `${l.name} wasn’t on your picks`, detail: "Check you actually ordered this." }); }
    if (menu && l.price !== menu.price) f.push({ level: "error", title: `${l.name}: price differs from menu`, detail: `Menu ${money(menu.price)}, billed ${money(l.price)}.` });
  });
  picks.forEach(p => { if (!bill.lines.some(l => l.name === p.name)) f.push({ level: "warn", title: `${p.name} is missing from the bill`, detail: "You may have been under-charged, or it was never served." }); });
  if (bill.serviceCharge > 0) f.push({ level: "warn", title: `Service charge ${money(bill.serviceCharge)} added`, detail: "Service charge is optional in India. You can politely ask for it to be removed." });
  const expected = Math.round(sub + bill.serviceCharge + sub * bill.taxPct / 100);
  if (Math.abs(expected - bill.billedTotal) > 1) f.push({ level: "error", title: "Total doesn’t add up", detail: `Lines + tax add to ${money(expected)} but the bill says ${money(bill.billedTotal)} (${money(bill.billedTotal - expected)} extra).` });
  const adjSub = sub - adj; const correct = Math.round(adjSub + bill.serviceCharge * (adjSub / (sub || 1)) + adjSub * bill.taxPct / 100);
  if (!f.some(x => x.level === "error")) f.push({ level: "ok", title: "No calculation errors found", detail: "Items, prices and total look consistent." });
  return { findings: f, correct };
}
const normName = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const jaccard = (a: string, b: string) => { const x = new Set(a.split(" ")), y = new Set(b.split(" ")); const i = [...x].filter(w => y.has(w)).length; return i / (x.size + y.size - i || 1) };
// OCR text rarely matches menu names exactly ("PALAK PANEER"), so snap each billed line to its closest menu dish before cross-checking.
const snapBill = (b: Bill, currentDishes: Dish[] = dishes): Bill => ({ ...b, lines: b.lines.map(l => { const n = normName(l.name); let best = currentDishes[0] || { name: l.name, price: l.price }, score = 0; currentDishes.forEach(d => { const sc = jaccard(n, normName(d.name)); if (sc > score) { score = sc; best = d } }); return score >= 0.5 ? { ...l, name: best.name, ...(best.price > 0 && l.price === 0 ? { price: best.price } : {}) } : l }) });
function Bill({ go, notify, cart, setPay }: { go: (s: Screen) => void; notify: (x: string) => void; cart: Record<string, number>; setPay: (p: { billed: number; correct: number }) => void }) {
  const { dishes: currentDishes, toStaff, say, play, outLang } = useApp(); const picks = pickLines(cart, currentDishes); const [phase, setPhase] = useState<"idle" | "reading" | "done">("idle"); const [file, setFile] = useState<{ name: string; url: string | null } | null>(null); const [bill, setBill] = useState<Bill | null>(null);
  const analyse = async (name: string, url: string | null, f: File | null) => {
    setFile({ name, url }); setPhase("reading");
    try {
      const b = f ? snapBill(await parseBill(f), currentDishes) : extractBill(picks);
      const res = crosscheck(b, picks, currentDishes);
      const hasErr = res.findings.some(x => x.level === "error");
      setBill(b);
      setPay({ billed: b.billedTotal, correct: hasErr ? res.correct : b.billedTotal });
      setPhase("done");
      const doneText = getPageAnnouncement("bill", outLang, { billTotal: b.billedTotal, billHasErrors: hasErr });
      play(doneText, outLang);
    }
    catch (e) { notify((e as ApiError)?.userMessage ?? "I couldn’t read that bill. Try a clearer photo."); reset() }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) analyse(f.name, f.type.startsWith("image/") ? URL.createObjectURL(f) : null, f) };
  const result = bill ? crosscheck(bill, picks) : null; const hasErrors = !!result?.findings.some(x => x.level === "error");
  const reset = () => { setPhase("idle"); setFile(null); setBill(null) };
  return <main className="content"><div className="title"><span className="eyebrow">YOUR BILL</span><h1>Check before you pay</h1><p>Upload a photo of the bill and SAHAAYA will cross-check it against your picks.</p></div>
    {phase === "idle" && <><label className="upload-box"><input type="file" accept="image/*,application/pdf" capture="environment" onChange={onFile} /><span className="option-icon"><Icon name="receipt" /></span><span><strong>Click to upload your bill</strong><small>Take a photo or choose an image / PDF</small></span><Icon name="upload" /></label><button className="describe" onClick={() => analyse("sample-bill.jpg", null, null)}><Icon name="menu" /><span><strong>Try a sample bill</strong><small>See how the cross-check works</small></span><Icon name="arrow" /></button></>}
    {phase === "reading" && <div className="note success" role="status"><Icon name="receipt" /><span><strong>Reading your bill…</strong><small>Matching items and checking the maths</small></span></div>}
    {phase === "done" && bill && result && <>
      {file?.url && <img className="bill-photo" src={file.url} alt="Your uploaded bill" />}
      <div className={`note ${hasErrors ? "warning" : "success"}`} role="status"><Icon name={hasErrors ? "alert" : "check"} /><span><strong>{hasErrors ? `${result.findings.filter(x => x.level === "error").length} possible mistake(s) found` : "Your bill looks correct"}</strong><small>{file?.name} · double-check with the waiter before paying</small></span></div>
      <section className="bill-card">{bill.lines.map(l => <div key={l.name}><span>{l.name} <small>× {l.qty}</small></span><strong>{money(l.price * l.qty)}</strong></div>)}{bill.serviceCharge > 0 && <div className="tax"><span>Service charge</span><strong>{money(bill.serviceCharge)}</strong></div>}<div className="tax"><span>GST · {bill.taxPct}%</span><strong>{money(bill.lines.reduce((n, l) => n + l.qty * l.price, 0) * bill.taxPct / 100)}</strong></div><footer><span>Billed total</span><strong>{money(bill.billedTotal)}</strong></footer></section>
      <section className="findings" aria-label="Cross-check results">{result.findings.map((x, i) => <article key={i} className={x.level}><Icon name={x.level === "ok" ? "check" : "alert"} size={20} /><span><strong>{x.title}</strong><small>{x.detail}</small></span></article>)}</section>
      {hasErrors && <div className="total"><span><small>Amount if mistakes are corrected</small><small>Estimate — ask staff to reissue the bill</small></span><strong>{money(result.correct)}</strong></div>}
      <Button onClick={() => hasErrors ? toStaff("Could you please check these items on my bill?") : say(`Your bill looks correct. The total is ${money(bill.billedTotal)}.`)} icon="sound" variant="secondary" className="wide">{hasErrors ? "Speak to the waiter about this" : "Read result aloud"}</Button>
      <Button onClick={() => { setPay({ billed: bill.billedTotal, correct: hasErrors ? result.correct : bill.billedTotal }); go("payment") }} icon="rupee" className="wide">Continue to UPI payment</Button>
      <button className="text-link" onClick={reset}><Icon name="camera" size={16} />Upload a different bill</button></>}
  </main>;
}
const UPI_ID = "sundara@upi", PAYEE = "Sundara Restaurant";
function Payment({ go, notify, pay }: { go: (s: Screen) => void; notify: (x: string) => void; pay: { billed: number; correct: number } }) {
  const same = pay.billed === pay.correct; const [which, setWhich] = useState<"billed" | "correct">(same ? "billed" : "correct"); const amount = which === "billed" ? pay.billed : pay.correct; const [vpa, setVpa] = useState(UPI_ID);
  const link = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(PAYEE)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Table 12 bill")}`;
  const apps = ["Google Pay", "PhonePe", "Paytm", "BHIM"];
  const copy = () => { navigator.clipboard?.writeText(vpa).then(() => notify("UPI ID copied"), () => notify("Copy not available")) };
  return <main className="content"><div className="title"><span className="eyebrow">PAY WITH UPI</span><h1>Pay {PAYEE}</h1><p>You’ll finish the payment in your own UPI app.</p></div>
    {!same && <section className="pay-choice" aria-label="Choose amount">{(["correct", "billed"] as const).map(k => <button key={k} className={which === k ? "selected" : ""} aria-pressed={which === k} onClick={() => setWhich(k)}><small>{k === "correct" ? "Corrected amount" : "As billed"}</small><strong>{money(k === "correct" ? pay.correct : pay.billed)}</strong></button>)}</section>}
    <div className="pay-amount"><small>Amount to pay</small><strong>{money(amount)}</strong></div>
    <label className="free-text"><span>Restaurant UPI ID</span><div className="vpa"><input value={vpa} onChange={e => setVpa(e.target.value)} aria-label="UPI ID" /><button onClick={copy} aria-label="Copy UPI ID"><Icon name="copy" size={18} /></button></div></label>
    <div className="upi-apps">{apps.map(a => <a key={a} href={link} className="button secondary" onClick={() => notify(`Opening ${a}…`)}><Icon name="rupee" />{a}</a>)}</div>
    <a href={link} className="button primary wide" onClick={() => notify("Opening your UPI app…")}><Icon name="rupee" /><span>Pay {money(amount)} with UPI</span></a>
    <div className="note warning"><Icon name="alert" /><span><strong>Verify before paying</strong><small>Confirm the UPI ID with the restaurant. On a desktop browser UPI links may not open — use your phone.</small></span></div>
    <Button onClick={() => go("feedback")} icon="check" variant="secondary" className="wide">I’ve completed the payment</Button></main>;
}
function Feedback({ restart }: { restart: () => void }) {
  const { inLang, notify } = useApp(); const [rating, setRating] = useState(0), [text, setText] = useState("");
  const { mic, toggle } = useListen(inLang, t => { if (t) setText(x => x ? `${x} ${t}` : t) }, notify);
  return <main className="content feedback"><span className="success-mark"><Icon name="check" size={34} /></span><span className="eyebrow">ALL DONE</span><h1>How was your experience?</h1><p>Your feedback helps the restaurant serve every guest better.</p><div className="rating">{[1, 2, 3, 4, 5].map(n => <button key={n} className={n <= rating ? "selected" : ""} onClick={() => setRating(n)} aria-label={`${n} stars`}><strong>★</strong><small>{n}</small></button>)}</div><label className="free-text"><span>Tell us more (optional)</span><textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Type your feedback…" /></label><button className="speak-feedback" onClick={toggle}><Icon name="mic" /><span><strong>{mic === "idle" ? "Speak your feedback" : mic === "listening" ? "Listening… tap to finish" : "Transcribing…"}</strong><small>{mic === "idle" ? "Tap to start recording" : "One moment"}</small></span></button><Button onClick={restart} icon="check" className="wide">Send feedback</Button><button className="text-link" onClick={restart}>Skip for now</button></main>;
}
function Settings({ close, hc, setHc }: { close: () => void; hc: boolean; setHc: (x: boolean) => void }) {
  const [size, setSize] = useState(1); const { speedIdx, setSpeedIdx } = useApp(); return <div className="backdrop sheet-bg" onMouseDown={close}><section className="sheet" onMouseDown={e => e.stopPropagation()}><i className="handle" /><header><span><small className="eyebrow">MAKE IT YOURS</small><h2>Accessibility settings</h2></span><button className="icon-button" onClick={close}><Icon name="close" /></button></header><label className="range"><span><strong>Text size</strong><b>{["100%", "125%", "150%", "200%"][size]}</b></span><input type="range" min="0" max="3" value={size} onChange={e => setSize(Number(e.target.value))} /></label><label className="range"><span><strong>Speech speed</strong><b>{SPEED_LABELS[speedIdx]}</b></span><input type="range" min="0" max="3" value={speedIdx} onChange={e => setSpeedIdx(Number(e.target.value))} /></label><div className="setting"><span><strong>Captions</strong><small>Show spoken words on screen</small></span><button className="switch on"><i /></button></div><div className="setting"><span><strong>High contrast</strong><small>Black, white and yellow</small></span><button onClick={() => setHc(!hc)} className={`switch ${hc ? "on" : ""}`}><i /></button></div><div className="live"><small className="eyebrow">LIVE PREVIEW</small><p className={`size-${size}`}>Your meal will arrive in 12 minutes.</p></div><Button onClick={close} icon="check" className="wide">Save settings</Button></section></div>;
}
function Demo({ close, persona, setPersona, network, setNetwork, miss, system }: { close: () => void; persona: Persona; setPersona: (x: Persona) => void; network: string; setNetwork: (x: string) => void; miss: () => void; system: () => void }) {
  const [hp, setHp] = useState(""); const check = async () => { setHp("Checking…"); try { const h = await health(); setHp(Object.entries(h).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")) } catch (e) { setHp((e as ApiError)?.userMessage ?? "Backend unreachable") } };
  return <div className="drawer-bg" onMouseDown={close}><aside className="drawer" onMouseDown={e => e.stopPropagation()}><header><span><small className="eyebrow">HACKATHON TOOL</small><h2>Demo controls</h2></span><button className="icon-button" onClick={close}><Icon name="close" /></button></header><label>Persona override<select value={persona} onChange={e => setPersona(e.target.value as Persona)}>{["Default", "Blind", "Deaf", "Non-speaking", "Elderly", "Hand-motor"].map(x => <option key={x}>{x}</option>)}</select></label><div className="inferred"><small className="eyebrow">INFERRED AND WHY</small><p><Icon name="spark" /><span><strong>{persona === "Default" ? "No adaptation" : `${persona} support`}</strong><small>Preference signals · demo override</small></span></p><button>Change signals <Icon name="arrow" /></button></div><div className="setting"><span><strong>Raw vs accessible</strong><small>Compare transformation</small></span><button className="switch"><i /></button></div><div className="setting"><span><strong>Network-drop simulator</strong><small>{network}</small></span><button onClick={() => setNetwork(network === "Offline" ? "Online" : "Offline")} className={`switch ${network === "Offline" ? "on" : ""}`}><i /></button></div><Button onClick={miss} icon="alert" variant="secondary" className="wide">Force ASR miss</Button><Button onClick={check} icon="wifi" variant="secondary" className="wide">Check backend health</Button>{hp && <small role="status">{hp}</small>}<Button onClick={system} icon="contrast" variant="ghost" className="wide">View design system</Button></aside></div>;
}
function DesignSystem({ close }: { close: () => void }) {
  return <div className="design-system"><header><Logo /><button className="icon-button" onClick={close}><Icon name="close" /></button></header><main><div className="title"><span className="eyebrow">FOUNDATIONS & COMPONENTS</span><h1>SAHAAYA design system</h1><p>Warm, dignified and accessible by default.</p></div><section><h2>Colour</h2><div className="swatches"><span>Indigo<small>#2B2F77</small></span><span>Saffron<small>#F2A33A</small></span><span>Canvas<small>#FAF7F2</small></span><span>Ink<small>#1E1E24</small></span></div></section><section><h2>Type</h2><div className="type-card"><h1>Clear words, calm rhythm.</h1><p>Inter · 18px base · generous line height</p><strong>भोजन तैयार है · భోజనం సిద్ధంగా ఉంది</strong></div></section><section><h2>Components</h2><div className="components"><Button icon="sound">Primary action</Button><Button icon="back" variant="secondary">Secondary</Button><span className="tag"><Icon name="leaf" size={15} />Vegetarian</span></div></section><section><h2>Accessibility annotations</h2><div className="a11y"><article><strong>1 · Focus order</strong><p>Header → content → conversation → input → always-on bar.</p></article><article><strong>2 · ARIA roles</strong><p>Named controls, modal dialogs and progress announcements.</p></article><article><strong>3 · Live regions</strong><p>Captions, network and voice confidence use polite updates.</p></article></div></section></main></div>;
}
function Network({ status, retry }: { status: string; retry: () => void }) { return status === "Online" ? null : <div className="network" role="status"><Icon name="wifi" /><span><strong>You’re offline</strong><small>You can still browse. Messages will send later.</small></span><button onClick={retry}>Retry</button></div>; }

function StaffView() {
  const [table, setTable] = useState(TABLE), [text, setText] = useState(""), [note, setNote] = useState(""); const relay = useRelay(table, "staff", "en");
  const { mic, toggle } = useListen("en", t => { if (t) setText(t) }, setNote);
  const orders = [{ n: 12, t: "Now", items: "2 items · ₹600", note: "Guest uses live captions" }, { n: 8, t: "3 min", items: "4 items · ₹1,240", note: "Reply in Hindi" }, { n: 3, t: "8 min", items: "1 item · ₹320", note: "Larger text enabled" }];
  const send = (t: string) => { if (!t.trim()) return; relay.send("staff_reply", { text: t.trim(), lang: "en" }); setText("") };
  const label = (m: { type: string; text?: string }) => m.text ?? (m.type === "waiter_call" ? "Guest called for a waiter" : m.type === "bill_request" ? "Guest asked for the bill" : m.type);
  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <div className="staff-app"><aside><div className="staff-logo"><Logo small /><b>STAFF</b></div><header><span><h1>Incoming</h1><small>Sunday lunch · 14 tables</small></span><b>3 active</b></header><nav>{orders.map(x => <button key={x.n} className={table === x.n ? "selected" : ""} onClick={() => setTable(x.n)}><span>TABLE {x.n}<small>{x.t}</small></span><strong>{x.items}</strong><em><Icon name="eye" size={15} />{x.note}</em></button>)}</nav><div className="staff-fallback"><span><strong>Auto-waiter fallback</strong><small>Scripted replies when busy</small></span><button className="switch on"><i /></button></div></aside><main><header><span><small className="eyebrow">ACTIVE CONVERSATION</small><h1>Table {table}</h1></span><b className="online">{relay.online ? "Connected" : "Reconnecting…"}</b></header><div className="guest-note"><Icon name="eye" /><span><strong>Communication preference</strong><small>Guest uses live captions. Keep replies clear and concise.</small></span></div><section className="messages" aria-live="polite">{relay.msgs.map(m => <article key={m.id}><small>{m.from === "staff" ? "You" : "Guest"} · {time(m.ts)}</small><p>{label(m)}</p>{m.from === "staff" && <em><Icon name="check" size={14} />Shown as live captions</em>}</article>)}</section><section className="quick"><small>QUICK REPLIES</small><div>{["On my way", "About 10 minutes", "I’ll check with the kitchen"].map(q => <button key={q} onClick={() => send(q)}>{q}</button>)}</div></section>{note && <small role="status">{note}</small>}<footer><button onClick={toggle} aria-label="Dictate reply"><Icon name="mic" /></button><input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send(text)} placeholder={mic === "idle" ? "Type a clear reply to the guest…" : mic === "listening" ? "Listening… tap the mic to finish" : "Transcribing…"} /><Button onClick={() => send(text)} icon="arrow">Send reply</Button></footer></main></div>;
}
export default function App() {
  const [screen, setScreen] = useState<Screen>("start"), [settings, setSettings] = useState(false), [demo, setDemo] = useState(false), [system, setSystem] = useState(false), [hc, setHc] = useState(false), [persona, setPersona] = useState<Persona>("Default"), [network, setNetwork] = useState("Online"), [low, setLow] = useState(false), [toast, setToast] = useState(""), [cart, setCart] = useState<Record<string, number>>({}), [prefs, setPrefs] = useState<Prefs>(defaultPrefs), [pay, setPay] = useState({ billed: 0, correct: 0 });
  const [langs, setLangs] = useState<{ i: Lang; o: Lang }>({ i: "en", o: "en" }), [speedIdx, setSpeedIdx] = useState(1), [heard, setHeard] = useState<string | null>(null), [reply, setReply] = useState<string | null>(null), [menuStats, setMenuStats] = useState<MenuStats | null>(null), [, setMenuVer] = useState(0);
  const [dishesState, setDishesState] = useState<Dish[]>(demoDishes);
  const setDishes = (d: Dish[]) => { setDishesGlobal(d); setDishesState(d); };
  const [keypadOpen, setKeypadOpen] = useState(false);
  const isStaff = location.pathname.startsWith("/staff");
  const notify = (x: string) => { setToast(x); setTimeout(() => setToast(""), 2600) }; const go = (s: Screen) => { setScreen(s); setHeard(null); setReply(null); window.scrollTo({ top: 0, behavior: "smooth" }) }; const next = () => go(journey[Math.min(journey.indexOf(screen) + 1, journey.length - 1)]); const back = () => screen === "phrases" ? go("staff") : go(journey[Math.max(0, journey.indexOf(screen) - 1)]);
  useEffect(() => { sim.offline = network === "Offline" }, [network]);
  const speech = useSpeech(langs.o, speedIdx, notify);
  const relay = useRelay(TABLE, "guest", langs.o, !isStaff && network === "Online");
  const run = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { notify((e as ApiError)?.userMessage ?? "Something went wrong. Please try again.") } };
  const callWaiter = () => { relay.send("waiter_call", { text: "Waiter requested" }); notify(relay.online ? "Waiter called. They’ll be with you shortly." : "You’re offline. Your call will send when you reconnect.") };
  const applyMenu = (m: ParsedMenu) => { const d = menuToDishes(m); if (!d.length) throw new Error("empty menu"); setDishes(d); setCart({}); setMenuStats({ items: d.length, sections: m.sections.length, unclear: m.unclear?.length ?? d.filter(x => x.price === 0).length }); setMenuVer(v => v + 1) };
  const loadMenu = async (file: File | null): Promise<boolean> => {
    if (!file) {
      try { applyMenu(await sampleMenu()); return true } catch {/* fall through to demo */ }
      setDishes(demoDishes); setCart({}); setMenuStats(null); setMenuVer(v => v + 1); notify("Showing demo menu."); return true;
    }
    try { applyMenu(await parseMenu(file, "en")); return true }
    catch (e) { notify((e as ApiError)?.userMessage ?? "I couldn’t read that menu. Try a clear, flat photo of the menu text."); return false }
  };

  // 5th page: update food descriptions to match selected language using Groq
  useEffect(() => {
    if (langs.o === "en" || !dishesState.length) return;
    let cancelled = false;
    translateMenuDishes(dishesState, langs.o).then(translated => {
      if (!cancelled && translated && translated.length) {
        setDishes(translated);
        setMenuVer(v => v + 1);
      }
    });
    return () => { cancelled = true; };
  }, [langs.o, dishesState]);
  const readCurrentPageRef = useRef<() => void>(() => { });

  const handleUserInput = useCallback((raw: string) => {
    const t = raw.toLowerCase().trim();
    setHeard(raw);
    notify(`Heard: "${raw}"`);

    if (screen === "start") {
      if (t.includes("start") || t.includes("begin") || t.includes("yes") || t.includes("ready") || t.includes("shuru") || t.includes("शुरू")) {
        go("language");
      }
      return;
    }

    if (screen === "language") {
      if (t.includes("hindi") || t.includes("हिंदी") || t.includes("हिन्दी")) {
        setLangs({ i: "hi", o: "hi" });
        notify("Hindi selected");
        go("entry");
        return;
      }
      if (t.includes("telugu") || t.includes("तेलुगु") || t.includes("తెలుగు")) {
        setLangs({ i: "te", o: "te" });
        notify("Telugu selected");
        go("entry");
        return;
      }
      if (t.includes("english") || t.includes("अंग्रेजी") || t.includes("ఇంగ్లీష్")) {
        setLangs({ i: "en", o: "en" });
        notify("English selected");
        go("entry");
        return;
      }
      if (t.includes("next") || t.includes("continue")) {
        go("entry");
        return;
      }
    }

    if (screen === "entry") {
      if (t.includes("camera") || t.includes("photo") || t.includes("take")) {
        go("scan");
        return;
      }
      if (t.includes("sample")) {
        loadMenu(null).then(() => go("ready"));
        return;
      }
      if (t.includes("upload") || t.includes("image") || t.includes("load") || t.includes("file")) {
        const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
        fileInput?.click();
        return;
      }
    }

    if (screen === "scan") {
      if (t.includes("capture") || t.includes("click") || t.includes("take")) {
        const btn = document.querySelector(".scan .button.primary") as HTMLButtonElement;
        btn?.click();
        return;
      }
    }

    if (screen === "ready") {
      if (t.includes("next") || t.includes("continue") || t.includes("preference") || t.includes("set")) {
        go("preferences");
        return;
      }
    }

    if (screen === "preferences") {
      if (t.includes("non-veg") || t.includes("non veg") || t.includes("chicken") || t.includes("meat")) {
        setPrefs(p => ({ ...p, diet: p.diet.includes("Non-veg") ? p.diet : [...p.diet, "Non-veg"] }));
        notify("Non-veg selected");
      } else if (t.includes("veg") || t.includes("vegetarian")) {
        setPrefs(p => ({ ...p, diet: p.diet.includes("Veg") ? p.diet : [...p.diet, "Veg"] }));
        notify("Veg selected");
      }
      if (t.includes("jain")) {
        setPrefs(p => ({ ...p, diet: p.diet.includes("Jain") ? p.diet : [...p.diet, "Jain"] }));
        notify("Jain selected");
      }
      if (t.includes("vegan")) {
        setPrefs(p => ({ ...p, diet: p.diet.includes("Vegan") ? p.diet : [...p.diet, "Vegan"] }));
        notify("Vegan selected");
      }
      if (t.includes("mild") || t.includes("less")) {
        setPrefs(p => ({ ...p, spice: "Less spicy" }));
        notify("Less spicy selected");
      }
      if (t.includes("medium")) {
        setPrefs(p => ({ ...p, spice: "Medium" }));
        notify("Medium spice selected");
      }
      if (t.includes("hot") || t.includes("spicy")) {
        setPrefs(p => ({ ...p, spice: "Hot" }));
        notify("Hot spice selected");
      }
      if (t.includes("nut")) {
        setPrefs(p => ({ ...p, avoid: p.avoid.includes("Nuts") ? p.avoid : [...p.avoid, "Nuts"] }));
        notify("Avoid Nuts selected");
      }
      if (t.includes("dairy") || t.includes("milk")) {
        setPrefs(p => ({ ...p, avoid: p.avoid.includes("Dairy") ? p.avoid : [...p.avoid, "Dairy"] }));
        notify("Avoid Dairy selected");
      }
      if (t.includes("next") || t.includes("show") || t.includes("done") || t.includes("continue") || t.includes("dishes")) {
        go("explore");
        return;
      }
    }

    if (screen === "explore") {
      const matchedDish = dishes.find(d => t.includes(d.name.toLowerCase()));
      if (matchedDish) {
        setCart(c => {
          const q = c[matchedDish.name] || 0;
          const nq = q ? 0 : 1;
          notify(nq ? `Added ${matchedDish.name} to picks` : `Removed ${matchedDish.name}`);
          return { ...c, [matchedDish.name]: nq };
        });
        return;
      }
      if (t.includes("next") || t.includes("order") || t.includes("shortlist") || t.includes("done") || t.includes("picks")) {
        go("order");
        return;
      }
    }

    if (screen === "order") {
      if (t.includes("save") || t.includes("next") || t.includes("continue") || t.includes("waiter")) {
        go("staff");
        return;
      }
    }

    if (screen === "staff") {
      relay.send("guest_text", { text: raw, lang: langs.i });
      notify(`Sent to waiter: "${raw}"`);
      return;
    }

    if (t.includes("repeat")) {
      readCurrentPageRef.current();
      return;
    }
  }, [screen, dishesState, loadMenu, go, notify, langs.i, relay]);

  const { mic, toggle, startListening, stopListening } = useListen(langs.i, (text, low) => {
    if (text) handleUserInput(text);
  }, notify);

  const readCurrentPage = useCallback(() => {
    // 1st page: talk all 3 languages when saying welcome in order!
    if (screen === "start") {
      speech.playSequence(welcomeSequence);
      return;
    }

    const list = dishesState.filter(d => matches(d, prefs));
    const picked = pickLines(cart, dishesState);
    const count = picked.reduce((n, l) => n + l.qty, 0);
    const total = picked.reduce((n, l) => n + l.qty * l.price, 0);
    const m = menuStats ?? { items: dishesState.length, sections: 1, unclear: 0 };

    const text = getPageAnnouncement(screen, langs.o, {
      menuItems: m.items,
      menuSections: m.sections,
      matchCount: list.length,
      picksCount: count,
      picksTotal: total,
      billTotal: pay.billed > 0 ? pay.billed : undefined,
      billHasErrors: pay.billed > 0 && pay.billed !== pay.correct,
    });

    // When voice stops reading out loud, automatically start mic to get user input!
    speech.play(text, langs.o, () => {
      if (["language", "preferences", "explore", "order", "entry", "scan", "ready", "phrases", "bill", "payment", "feedback"].includes(screen)) {
        startListening();
      }
    });
  }, [screen, langs.o, prefs, cart, menuStats, pay, speech, startListening, dishesState]);
  readCurrentPageRef.current = readCurrentPage;

  const userInteractedRef = useRef(false);
  useEffect(() => {
    if (isStaff || system) return;
    readCurrentPageRef.current();

    let cancelled = false;
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (!cancelled && !userInteractedRef.current) {
        userInteractedRef.current = true;
        readCurrentPageRef.current();
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      speech.stop();
      stopListening();
    };
  }, [screen, langs.o, isStaff, system]);

  const ctx: AppCtx = {
    inLang: langs.i, outLang: langs.o, setLangs: (i, o) => setLangs({ i, o }), speedIdx, setSpeedIdx, notify, play: speech.play, replay: readCurrentPage, heard, setHeard, reply, relay, loadMenu, menuStats,
    mic, toggle, startListening, stopListening, openKeypad: () => setKeypadOpen(true), dishes: dishesState,
    setLow: b => { if (!b) sim.flags.delete("asr_low_confidence"); setLow(b) },
    say: t => run(async () => { setReply(await speech.say(t)) }),
    explain: t => run(async () => { const o = await explainSimpler(t, langs.o); setReply(o); await speech.play(o, langs.o) }),
    simpler: () => run(async () => { const l = speech.last.current; if (!l) { notify("Nothing to simplify yet"); return } const o = await explainSimpler(l.text, l.lang); setReply(o); await speech.play(o, l.lang) }),
    describeTable: d => run(async () => { const o = await describe("table", d, langs.o); setReply(o); await speech.play(o, langs.o) }),
    toStaff: (text, phraseId, from = "en") => run(async () => { const t = from === STAFF_LANG ? text : (await mt([text], from, STAFF_LANG))[0]; relay.send(phraseId ? "phrase" : "guest_text", { text: t, lang: STAFF_LANG, phraseId }); await speech.play(t, STAFF_LANG); notify(`Said: “${t}”`) }),
  };
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === " " && screen === "start") { e.preventDefault(); go("language") } if (e.key.toLowerCase() === "b") back(); if (e.key.toLowerCase() === "w") callWaiter() }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key) });
  if (isStaff) return <StaffView />; if (system) return <DesignSystem close={() => setSystem(false)} />;
  const shell = !["start", "language"].includes(screen);
  return <AppContext.Provider value={ctx}><div className={`app ${hc ? "high-contrast" : ""} persona-${persona.toLowerCase().replace("-", "")}`}><Network status={network} retry={() => setNetwork("Online")} />{shell && <Header screen={screen} settings={() => setSettings(true)} demo={() => setDemo(true)} />}
    {screen === "start" && <Start next={() => go("language")} settings={() => setSettings(true)} demo={() => setDemo(true)} />} {screen === "language" && <Language next={() => go("entry")} onKeypad={() => setKeypadOpen(true)} />} {screen === "entry" && <Entry go={go} />} {screen === "scan" && <Scan next={() => go("ready")} />} {screen === "ready" && <Ready next={() => go("preferences")} retake={() => go("entry")} />} {screen === "preferences" && <Preferences prefs={prefs} setPrefs={setPrefs} next={() => go("explore")} />} {screen === "explore" && <Explore go={go} cart={cart} setCart={setCart} notify={notify} prefs={prefs} />} {screen === "order" && <Order go={go} cart={cart} setCart={setCart} />} {screen === "staff" && <StaffChat go={go} deaf={persona === "Deaf"} />} {screen === "phrases" && <Phrases back={() => go("staff")} notify={notify} />} {screen === "bill" && <Bill go={go} notify={notify} cart={cart} setPay={setPay} />} {screen === "payment" && <Payment go={go} notify={notify} pay={pay} />} {screen === "feedback" && <Feedback restart={() => { setCart({}); setPrefs(defaultPrefs); go("start") }} />}
    <AlwaysBar back={back} call={callWaiter} notify={notify} /> {settings && <Settings close={() => setSettings(false)} hc={hc} setHc={setHc} />} {demo && <Demo close={() => setDemo(false)} persona={persona} setPersona={setPersona} network={network} setNetwork={setNetwork} miss={() => { sim.flags.add("asr_low_confidence"); setLow(true); setDemo(false) }} system={() => { setSystem(true); setDemo(false) }} />}
    {low && shell && <div className="low-confidence"><InputDock warning phrases={() => go("phrases")} notify={notify} onKeypad={() => setKeypadOpen(true)} /><button onClick={() => ctx.setLow(false)}><Icon name="close" /></button></div>}
    {persona !== "Default" && shell && <div className="adapt"><Icon name="spark" /><span><strong>We adjusted this view for you</strong><small>{persona === "Elderly" ? "Larger text and simpler steps are on." : persona === "Non-speaking" ? "Quick phrases are easier to reach." : "Your preferred support is active."}</small></span><button onClick={() => { setPersona("Default"); notify("Adaptation undone") }}>Undo</button></div>}
    {mic === "listening" && <div className="adapt" style={{ bottom: "90px", top: "auto", background: "var(--p)", color: "#fff", borderColor: "var(--a)" }}><Icon name="mic" /><span><strong>Listening to you…</strong><small>Speak your choice or type below</small></span><button onClick={() => setKeypadOpen(true)} style={{ border: 0, background: "var(--a)", color: "var(--ink)", borderRadius: "8px", padding: "5px 10px", fontWeight: "bold" }}>Use Keypad</button><button onClick={stopListening} style={{ border: 0, background: "none", color: "#fff" }}>Stop</button></div>}
    <KeypadModal open={keypadOpen} close={() => setKeypadOpen(false)} onSubmit={handleUserInput} />
    {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}</div></AppContext.Provider>;
}
