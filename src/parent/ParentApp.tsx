import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { useDailyBrief } from "../Brief";
import { useTab, useUi } from "../ui/ui";
import { Redemption, Task, Wallet, rpc, sb } from "../supabase";
import { Queue } from "./Queue";
import { Manage } from "./Manage";
import { Errands, ErrandSheet } from "./Errands";
import { Settings } from "./Settings";
import { History } from "../History";

const TABS = [["queue", "✅", "待辦"], ["errands", "📌", "交辦"], ["history", "📖", "回顧"], ["manage", "🗂️", "任務獎勵"], ["settings", "⚙️", "設定"]] as const;
type Tab = (typeof TABS)[number][0];

export interface ParentData { queue: Task[]; reds: Redemption[]; wallets: Record<string, Wallet>; reload: () => Promise<void> }

export function ParentApp() {
  const { me, members, tick } = useStore(); const ui = useUi();
  const [tab, setTab] = useTab<Tab>(TABS.map((t) => t[0]), "queue");
  useDailyBrief((t) => { if (me?.role !== "guest") setTab(t as Tab); });
  const [fab, setFab] = useState(false);
  const [d, setD] = useState<Omit<ParentData, "reload">>({ queue: [], reds: [], wallets: {} });
  const kids = members.filter((m) => m.role === "child");
  const isGuest = me?.role === "guest";

  const reload = useCallback(async () => {
    if (!me) return;
    if (isGuest) return;
    await rpc("ensure_today").catch(() => {});
    const [q, r, ...ws] = await Promise.all([
      sb.from("tasks").select("*").eq("status", "submitted").order("submitted_at"),
      sb.from("redemptions").select("*").eq("status", "pending").order("created_at"),
      ...kids.map((k) => rpc<Wallet>("get_wallet", { p_member: k.id })),
    ]);
    const wallets: Record<string, Wallet> = {}; (ws as Wallet[]).forEach((w) => (wallets[w.member_id] = w));
    setD({ queue: (q.data ?? []) as Task[], reds: (r.data ?? []) as Redemption[], wallets });
  }, [me, kids.map((k) => k.id).join(), isGuest]); // eslint-disable-line
  useEffect(() => { reload(); }, [reload, tick]);
  const data: ParentData = { ...d, reload };
  const pending = d.queue.length + d.reds.length;

  if (isGuest) return <div className="app mode-parent"><div className="screen"><div className="card empty"><span className="big">👋</span>訪客身份目前只能看看。</div><button className="btn line" onClick={() => sb.auth.signOut()}>登出</button></div></div>;

  return <div className="app mode-parent">
    <div className="screen">
      {tab === "queue" && <Queue data={data} />}
      {tab === "manage" && <Manage />}
      {tab === "errands" && <Errands />}
      {tab === "history" && <History />}
      {tab === "settings" && <Settings />}
    </div>
    {fab && <div className="fab-menu">
      <button onClick={() => { setFab(false); ui.sheet(<BonusSheet onDone={reload} />); }}>⭐ 給激勵點</button>
      <button onClick={() => { setFab(false); ui.sheet(<ErrandSheet />); }}>📌 交辦事項</button>
      <button onClick={() => { setFab(false); ui.sheet(<DeductSheet onDone={reload} />); }}>⚠️ 扣點</button>
    </div>}
    <button className={`fab ${fab ? "open" : ""}`} aria-label="快速動作" aria-expanded={fab} onClick={() => setFab(!fab)}>＋</button>
    <nav className="tabs">{TABS.map(([k, i, l]) => <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => { setTab(k); setFab(false); }}><span className="ic">{i}</span>{l}{k === "queue" && pending > 0 && <span className="badge">{pending}</span>}</button>)}</nav>
  </div>;
}

export function BonusSheet({ onDone, kidId }: { onDone: () => void; kidId?: string }) {
  const { members } = useStore(); const ui = useUi(); const kids = members.filter((m) => m.role === "child");
  const [kid, setKid] = useState(kidId ?? kids[0]?.id); const [amt, setAmt] = useState(20); const [why, setWhy] = useState("貼心"); const [other, setOther] = useState("");
  if (!kids.length) return <><h3>還沒有孩子帳號</h3><p>到「設定 → 家庭成員」新增孩子。</p></>;
  return <>
    <h3>給激勵點</h3><p>選一個理由，讓孩子知道哪個行為被看見。</p>
    {kids.length > 1 && <div className="row">{kids.map((k) => <button key={k.id} className={`chip ${kid === k.id ? "on" : ""}`} onClick={() => setKid(k.id)}>{k.avatar} {k.display_name}</button>)}</div>}
    <div className="row">{[10, 20, 50, 100].map((a) => <button key={a} className={`chip ${amt === a ? "on" : ""}`} onClick={() => setAmt(a)}>+{a}</button>)}</div>
    <div className="row">{["貼心", "勇敢", "認真", "進步", "誠實", "其他"].map((w) => <button key={w} className={`chip ${why === w ? "on" : ""}`} onClick={() => setWhy(w)}>{w}</button>)}</div>
    {why === "其他" && <label className="field">原因<input type="text" id="b-other" value={other} onChange={(e) => setOther(e.target.value)} maxLength={30} /></label>}
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" onClick={async () => { const r = await ui.busy(rpc("give_bonus", { p_member: kid, p_amount: amt, p_reason: why === "其他" ? other : why })); if (r !== undefined) { ui.sheet(null); ui.toast(`已送出 +${amt}`); onDone(); } }}>送出</button></div>
  </>;
}

// 扣點：常見原因快選、每天有上限，避免一時情緒扣太多
export function DeductSheet({ onDone, kidId }: { onDone: () => void; kidId?: string }) {
  const { members } = useStore(); const ui = useUi(); const kids = members.filter((m) => m.role === "child");
  const [kid, setKid] = useState(kidId ?? kids[0]?.id); const [amt, setAmt] = useState(10); const [why, setWhy] = useState(""); const [other, setOther] = useState("");
  const [st, setSt] = useState<{ used: number; cap: number; reasons: string | null } | null>(null);
  useEffect(() => { if (kid) rpc<{ used: number; cap: number; reasons: string | null }>("deduct_status", { p_member: kid }).then(setSt).catch(() => setSt(null)); }, [kid]);
  if (!kids.length) return <><h3>還沒有孩子帳號</h3><p>到「設定 → 家庭成員」新增孩子。</p></>;
  const left = st ? Math.max(0, st.cap - st.used) : 0;
  const reasons = (st?.reasons ?? "").split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean);
  const reason = why === "其他" ? other.trim() : why;
  return <>
    <h3>⚠️ 扣點</h3><p>先深呼吸。選一個具體原因，孩子和其他家長都會收到通知。</p>
    {kids.length > 1 && <div className="row">{kids.map((k) => <button key={k.id} className={`chip ${kid === k.id ? "on" : ""}`} onClick={() => setKid(k.id)}>{k.avatar} {k.display_name}</button>)}</div>}
    {st && <div className={`cap-meter ${left === 0 ? "full" : ""}`}><div><b>今天已扣 {st.used} / {st.cap} 點</b><small>{left === 0 ? "今天的扣點上限到了，明天再說" : `還能扣 ${left} 點`}</small></div><div className="goal-bar"><i style={{ width: `${Math.min(100, (st.used / Math.max(1, st.cap)) * 100)}%` }} /></div></div>}
    <div className="field">原因<div className="row">{[...reasons, "其他"].map((w) => <button key={w} className={`chip ${why === w ? "on" : ""}`} onClick={() => setWhy(w)}>{w}</button>)}</div></div>
    {why === "其他" && <label className="field">寫下原因<input type="text" id="d-other" value={other} onChange={(e) => setOther(e.target.value)} maxLength={30} /></label>}
    <div className="field">扣幾點<div className="row">{[5, 10, 20, 30].map((a) => <button key={a} className={`chip ${amt === a ? "on" : ""}`} disabled={!!st && a > left} onClick={() => setAmt(a)}>-{a}</button>)}</div></div>
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn bad" disabled={!reason || !st || amt > left} onClick={async () => { const r = await ui.busy(rpc("deduct_points", { p_member: kid, p_amount: amt, p_reason: reason })); if (r !== undefined) { ui.sheet(null); ui.toast(`已扣 ${amt} 點`); onDone(); } }}>扣 {amt} 點</button></div>
  </>;
}
