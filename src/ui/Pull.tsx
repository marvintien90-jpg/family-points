import { ReactNode, useRef, useState } from "react";
import { useStore } from "../store";

// 在畫面最上方往下拉，放開後重新載入資料
const TRIGGER = 64;
export function PullScreen({ children }: { children: ReactNode }) {
  const { refresh } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0); const [busy, setBusy] = useState(false);
  const onStart = (e: React.TouchEvent) => { start.current = !busy && (ref.current?.scrollTop ?? 1) <= 0 ? e.touches[0].clientY : null; };
  const onMove = (e: React.TouchEvent) => {
    if (start.current === null) return;
    const dy = e.touches[0].clientY - start.current;
    if (dy <= 0 || (ref.current?.scrollTop ?? 0) > 0) { setPull(0); return; }
    setPull(Math.min(96, dy * 0.5));
  };
  const onEnd = () => {
    if (start.current === null) return; start.current = null;
    if (pull >= TRIGGER * 0.75) { setBusy(true); setPull(48); refresh(); setTimeout(() => { setBusy(false); setPull(0); }, 800); }
    else setPull(0);
  };
  return <div className="screen" ref={ref} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
    {(pull > 0 || busy) && <div className="ptr" style={{ height: pull, marginBottom: -14 }} aria-live="polite">{busy ? <div className="spinner" /> : pull >= TRIGGER * 0.75 ? "放開重新整理" : "下拉重新整理"}</div>}
    {children}
  </div>;
}
