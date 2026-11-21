import { ReactNode, useRef, useState } from "react";

export interface SwipeAction { label: string; icon: string; tone: "good" | "bad" | "gold" | "acc"; run: () => void }

// 左右滑動的卡片：往右滑觸發 right，往左滑觸發 left；滑超過門檻放開才會執行
export function SwipeRow({ left, right, onTap, children }: { left?: SwipeAction; right?: SwipeAction; onTap?: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0); const [anim, setAnim] = useState(false);
  const st = useRef<{ x: number; y: number; drag: boolean; id: number } | null>(null); const moved = useRef(false);
  const TH = 88, MAX = 132;
  const down = (e: React.PointerEvent) => { st.current = { x: e.clientX, y: e.clientY, drag: false, id: e.pointerId }; moved.current = false; setAnim(false); };
  const move = (e: React.PointerEvent) => {
    const s = st.current; if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.drag) { if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) { s.drag = true; moved.current = true; (e.currentTarget as HTMLElement).setPointerCapture(s.id); } else if (Math.abs(my) > 12) { st.current = null; return; } else return; }
    let v = mx; if (v > 0 && !right) v = v / 6; if (v < 0 && !left) v = v / 6;
    setDx(Math.max(-MAX, Math.min(MAX, v)));
  };
  const up = () => {
    const s = st.current; st.current = null; setAnim(true);
    if (s?.drag) { if (dx >= TH && right) { setDx(0); right.run(); return; } if (dx <= -TH && left) { setDx(0); left.run(); return; } }
    setDx(0);
  };
  const p = Math.min(1, Math.abs(dx) / TH); const act = dx > 0 ? right : left;
  return <div className="swipe">
    {right && <div className={`swipe-bg r tone-${right.tone} ${dx >= TH ? "armed" : ""}`} style={{ opacity: dx > 0 ? 1 : 0 }}><span style={{ transform: `scale(${0.7 + p * 0.45})` }}>{right.icon}</span>{right.label}</div>}
    {left && <div className={`swipe-bg l tone-${left.tone} ${dx <= -TH ? "armed" : ""}`} style={{ opacity: dx < 0 ? 1 : 0 }}>{left.label}<span style={{ transform: `scale(${0.7 + p * 0.45})` }}>{left.icon}</span></div>}
    <div className={`swipe-fg ${anim ? "anim" : ""}`} style={{ transform: `translateX(${dx}px) rotate(${dx / 60}deg)` }} aria-label={act ? `往${dx > 0 ? "右" : "左"}滑：${act.label}` : undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } }}
      onClick={() => onTap?.()}>{children}</div>
  </div>;
}
