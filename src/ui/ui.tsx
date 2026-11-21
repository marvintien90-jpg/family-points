import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { ErrorBoundary } from "./ErrorBoundary";

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return <><div className="scrim" onClick={onClose} /><div className="sheet" role="dialog" aria-modal="true"><div className="grab" /><button className="x" aria-label="關閉" onClick={onClose}>✕</button><ErrorBoundary small>{children}</ErrorBoundary></div></>;
}
export function Dialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <><div className="scrim" onClick={onClose} /><div className="dialog" role="alertdialog" aria-modal="true"><button className="x" aria-label="關閉" onClick={onClose}>✕</button><ErrorBoundary small>{children}</ErrorBoundary></div></>;
}

interface Ui {
  toast: (msg: string, undo?: () => void) => void;
  celebrate: (emoji: string, title: string, body: string) => void;
  banner: (title: string, body: string) => void;
  sheet: (node: ReactNode | null) => void;
  dialog: (node: ReactNode | null) => void;
  busy: <T>(p: Promise<T>) => Promise<T | undefined>;
}
const Ctx = createContext<Ui>(null as unknown as Ui);
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [cel, setCel] = useState<{ e: string; t: string; b: string } | null>(null);
  const [ban, setBan] = useState<{ t: string; b: string } | null>(null);
  const [sheet, setSheet] = useState<ReactNode | null>(null);
  const [dialog, setDialog] = useState<ReactNode | null>(null);
  const tt = useRef<number>(), bt = useRef<number>();
  // 開啟彈出視窗時多一筆瀏覽紀錄，讓 iPhone 返回手勢或瀏覽器上一頁可以關閉它
  const hist = useRef({ pushed: false, skipping: false, wantPush: false });
  const open = !!(sheet || dialog);
  useEffect(() => {
    const h = hist.current;
    if (open) {
      if (h.pushed) return;
      if (h.skipping) { h.wantPush = true; return; }
      history.pushState({ fpOverlay: 1 }, ""); h.pushed = true;
    } else {
      if (h.skipping) h.wantPush = false;
      if (!h.pushed) return;
      h.pushed = false; h.skipping = true; history.back();
    }
  }, [open]);
  useEffect(() => {
    const onPop = () => {
      const h = hist.current;
      if (h.skipping) { h.skipping = false; if (h.wantPush) { h.wantPush = false; history.pushState({ fpOverlay: 1 }, ""); h.pushed = true; } return; }
      if (h.pushed) { h.pushed = false; setSheet(null); setDialog(null); }
    };
    addEventListener("popstate", onPop); return () => removeEventListener("popstate", onPop);
  }, []);
  const api: Ui = {
    toast: useCallback((msg, undo) => { clearTimeout(tt.current); setToast({ msg, undo }); tt.current = window.setTimeout(() => setToast(null), undo ? 5000 : 2600); }, []),
    celebrate: useCallback((e, t, b) => { setCel({ e, t, b }); if (!reduce()) confetti({ particleCount: 140, spread: 80, origin: { y: 0.35 }, zIndex: 80 }); }, []),
    banner: useCallback((t, b) => { clearTimeout(bt.current); setBan({ t, b }); bt.current = window.setTimeout(() => setBan(null), 4000); }, []),
    sheet: setSheet, dialog: setDialog,
    busy: useCallback(async (p) => { try { return await p; } catch (e) { setToast({ msg: e instanceof Error ? e.message : String(e) }); clearTimeout(tt.current); tt.current = window.setTimeout(() => setToast(null), 3500); return undefined; } }, []),
  };
  return <Ctx.Provider value={api}>
    {children}
    {sheet && <Sheet onClose={() => setSheet(null)}>{sheet}</Sheet>}
    {dialog && <Dialog onClose={() => setDialog(null)}>{dialog}</Dialog>}
    {toast && <div className="toast" role="status"><span>{toast.msg}</span>{toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>復原</button>}</div>}
    {ban && <div className="banner" role="status" onClick={() => setBan(null)}><img src="./icon-192.png" alt="" /><div><b>{ban.t}</b><span>{ban.b}</span></div></div>}
    {cel && <div className="celebrate" onClick={() => setCel(null)}><div className="box" onClick={(e) => e.stopPropagation()}><div className="big">{cel.e}</div><b>{cel.t}</b><p style={{ margin: 0, color: "var(--muted)" }}>{cel.b}</p><button className="btn" onClick={() => setCel(null)}>太棒了</button></div></div>}
  </Ctx.Provider>;
}

// 分頁切換也記在瀏覽紀錄裡，返回會回到上一個分頁
export function useTab<T extends string>(valid: readonly T[], def: T): [T, (t: T) => void] {
  const read = () => { const q = new URLSearchParams(location.search).get("tab") as T | null; return q && valid.includes(q) ? q : def; };
  const [tab, setTab] = useState<T>(read);
  useEffect(() => { const f = () => { if (!(history.state && history.state.fpOverlay)) setTab(read()); }; addEventListener("popstate", f); return () => removeEventListener("popstate", f); }, []); // eslint-disable-line
  const go = useCallback((t: T) => { setTab((cur) => { if (cur !== t) history.pushState({ tab: t }, "", `?tab=${t}`); return t; }); document.querySelector(".screen")?.scrollTo(0, 0); }, []);
  return [tab, go];
}

export function RollNumber({ value, id }: { value: number; id?: string }) {
  const [shown, setShown] = useState(value); const prev = useRef(value);
  useEffect(() => {
    const from = prev.current; prev.current = value;
    if (from === value || reduce()) { setShown(value); return; }
    const t0 = performance.now(); let raf = 0;
    const f = (t: number) => { const k = Math.min(1, (t - t0) / 800); setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="n" id={id}>{shown}</span>;
}

export function flyCoins(from: Element | null, toId: string) {
  const to = document.getElementById(toId); if (!from || !to || reduce()) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  for (let i = 0; i < 5; i++) {
    const c = document.createElement("span"); c.className = "coin"; c.textContent = "🪙";
    c.style.left = `${a.left + a.width / 2 - 11 + (i - 2) * 8}px`; c.style.top = `${a.top + a.height / 2 - 11}px`; document.body.appendChild(c);
    setTimeout(() => { c.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width / 2 - (i - 2) * 8}px,${b.top + b.height / 2 - a.top - a.height / 2}px) scale(.6)`; c.style.opacity = ".2"; }, 30 + i * 70);
    setTimeout(() => c.remove(), 900 + i * 70);
  }
}
export function floatPoints(text: string, anchor: Element | null) {
  if (!anchor || reduce()) return; const r = anchor.getBoundingClientRect();
  const el = document.createElement("span"); el.className = "float-pts"; el.textContent = text;
  el.style.left = `${r.left + r.width / 2 - 30}px`; el.style.top = `${r.top}px`; document.body.appendChild(el); setTimeout(() => el.remove(), 1300);
}

export const EMOJIS = ["✅", "🪥", "🛏️", "🎒", "📚", "👕", "🎹", "🧸", "📖", "🍽️", "🧹", "🌱", "🐶", "🚗", "💪", "🏃", "🧺", "🗑️", "✏️", "🎨", "⚽", "🏊", "🎁", "🍦", "📱", "🌙", "🍕", "📕", "🧱", "🎢", "🎮", "🎬", "📌", "🪪", "💡", "🛒"];
export function EmojiPick({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return <div className="emoji-grid">{EMOJIS.map((e) => <button key={e} type="button" className={e === value ? "on" : ""} onClick={() => onChange(e)} aria-label={e}>{e}</button>)}</div>;
}
