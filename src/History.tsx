import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { Ledger, Redemption, Task, rpc, sb } from "./supabase";
import { useUi } from "./ui/ui";

const EARN = ["task", "pack", "bonus", "interest", "deposit_bonus", "undo", "adjust"];
const EDITABLE = ["task", "pack", "bonus"];
// 這筆紀錄目前實際有效的點數（任務類含撤銷、修改；激勵只看修改）
const isPack = (l: Ledger) => l.ref_type === "pack" || l.reason.endsWith("全勤獎");
export function netOf(rows: Ledger[], l: Ledger) {
  if (l.ref_id && (l.ref_type === "task" || l.ref_type === "pack"))
    return rows.filter((x) => x.ref_id === l.ref_id && x.account === "spend" && ["task", "pack", "undo", "adjust"].includes(x.ref_type ?? "") && isPack(x) === isPack(l)).reduce((a, x) => a + x.amount, 0);
  return l.amount + rows.filter((x) => x.ref_ledger === l.id).reduce((a, x) => a + x.amount, 0);
}
const dayTW = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(iso));
const pretty = (d: string) => { const t = dayTW(new Date()), y = dayTW(new Date(Date.now() - 864e5)); if (d === t) return "今天"; if (d === y) return "昨天"; const x = new Date(d + "T12:00:00+08:00"); return x.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" }); };
const icon = (l: Ledger) => l.ref_type === "pack" ? "🏅" : l.ref_type === "bonus" ? "⭐" : l.ref_type === "interest" ? "🪙" : l.ref_type === "redeem" ? "🎁" : l.ref_type === "refund" ? "↩️" : l.ref_type === "undo" || l.ref_type === "adjust" ? "⏪" : l.ref_type?.startsWith("deposit") ? "🫙" : l.ref_type === "withdraw" ? "🫙" : "✅";

// 歷史回顧：點數趨勢、完成率、每天發生的事
export function History() {
  const { me, members } = useStore(); const ui = useUi();
  const isAdmin = me?.role === "admin";
  const [reload, setReload] = useState(0);
  const kids = members.filter((m) => m.role === "child");
  const isKid = me?.role === "child";
  const [who, setWho] = useState<string>(isKid ? me!.id : kids[0]?.id ?? "");
  const [range, setRange] = useState<"week" | "month" | "all">("week");
  const [data, setData] = useState<{ ledger: Ledger[]; tasks: Task[]; reds: Redemption[] } | null>(null);
  const [limit, setLimit] = useState(40);

  const start = useMemo(() => {
    const now = new Date(dayTW(new Date()) + "T00:00:00+08:00");
    if (range === "week") { const dow = new Date(dayTW(new Date()) + "T12:00:00+08:00").getUTCDay(); return new Date(now.getTime() - ((dow + 6) % 7) * 864e5); }
    if (range === "month") return new Date(dayTW(new Date()).slice(0, 8) + "01T00:00:00+08:00");
    return new Date(now.getTime() - 89 * 864e5);
  }, [range]);
  const chartStart = useMemo(() => new Date(new Date(dayTW(new Date()) + "T00:00:00+08:00").getTime() - 13 * 864e5), []);

  useEffect(() => {
    if (!who) { setData({ ledger: [], tasks: [], reds: [] }); return; }
    const from = new Date(Math.min(start.getTime(), chartStart.getTime())).toISOString();
    setData(null); setLimit(40);
    Promise.all([
      sb.from("ledger").select("*").eq("member_id", who).gte("created_at", from).order("created_at", { ascending: false }).limit(1000),
      sb.from("tasks").select("*").eq("assignee", who).gte("created_at", from).order("created_at", { ascending: false }).limit(1000),
      sb.from("redemptions").select("*").eq("member_id", who).gte("created_at", from).order("created_at", { ascending: false }),
    ]).then(([l, t, r]) => setData({ ledger: (l.data ?? []) as Ledger[], tasks: (t.data ?? []) as Task[], reds: (r.data ?? []) as Redemption[] }));
  }, [who, start, chartStart, reload]);

  if (!isKid && kids.length === 0) return <><h2 className="sec">歷史回顧</h2><div className="card empty"><span className="big">📖</span>新增孩子之後，這裡會整理每週的努力和點數變化。</div></>;

  const inRange = (iso: string) => new Date(iso) >= start;
  const L = (data?.ledger ?? []).filter((l) => inRange(l.created_at));
  const earned = L.filter((l) => EARN.includes(l.ref_type ?? "")).reduce((a, l) => a + l.amount, 0);
  const spent = L.filter((l) => l.ref_type === "redeem" || l.ref_type === "refund").reduce((a, l) => a - l.amount, 0);
  const saved = L.filter((l) => l.ref_type === "deposit" && l.account === "jar").reduce((a, l) => a + l.amount, 0);
  const T = (data?.tasks ?? []).filter((t) => inRange(t.created_at) || (t.for_date && new Date(t.for_date + "T12:00:00+08:00") >= start));
  const routines = T.filter((t) => t.kind === "routine" && t.status !== "void" && t.for_date && t.for_date <= dayTW(new Date()));
  const doneR = routines.filter((t) => t.status === "approved").length;
  const rate = routines.length ? Math.round((doneR / routines.length) * 100) : 0;
  const doneAll = T.filter((t) => t.status === "approved").length;
  const proposals = T.filter((t) => t.kind === "proposal" && t.status === "approved").length;

  // 14 天趨勢
  const days = Array.from({ length: 14 }, (_, i) => dayTW(new Date(chartStart.getTime() + i * 864e5 + 3600e3)));
  const perDay = days.map((d) => (data?.ledger ?? []).filter((l) => EARN.includes(l.ref_type ?? "") && dayTW(l.created_at) === d).reduce((a, l) => a + l.amount, 0));
  const maxV = Math.max(10, ...perDay); const best = perDay.indexOf(Math.max(...perDay));

  // 時間軸
  const adjOf = new Map<number, number>();
  (data?.ledger ?? []).forEach((l) => { if (l.ref_ledger) adjOf.set(l.ref_ledger, (adjOf.get(l.ref_ledger) ?? 0) + l.amount); });
  const V = L.filter((l) => !l.ref_ledger);
  const rateOf = new Map<string, string>(); (data?.tasks ?? []).forEach((t) => { if (t.rating) rateOf.set(t.id, t.rating); });
  const canEdit = (l: Ledger) => isAdmin && l.account === "spend" && EDITABLE.includes(l.ref_type ?? "");
  const openEdit = (l: Ledger) => ui.sheet(<EditSheet l={l} now={netOf(data?.ledger ?? [], l)} onDone={() => { ui.sheet(null); setReload((x) => x + 1); }} />);
  const groups = new Map<string, Ledger[]>();
  V.slice(0, limit).forEach((l) => { const d = dayTW(l.created_at); groups.set(d, [...(groups.get(d) ?? []), l]); });
  const kidName = members.find((m) => m.id === who)?.display_name ?? "";

  return <>
    <h2 className="sec">歷史回顧<small>{isKid ? "看看自己的努力" : `${kidName}的成長紀錄`}</small></h2>
    {!isKid && kids.length > 1 && <div className="row">{kids.map((k) => <button key={k.id} className={`chip ${who === k.id ? "on" : ""}`} onClick={() => setWho(k.id)}>{k.avatar} {k.display_name}</button>)}</div>}
    <div className="seg three"><button className={range === "week" ? "on" : ""} onClick={() => setRange("week")}>本週</button><button className={range === "month" ? "on" : ""} onClick={() => setRange("month")}>本月</button><button className={range === "all" ? "on" : ""} onClick={() => setRange("all")}>近 90 天</button></div>
    {!data ? <div className="spinner" /> : <>
      <div className="stats">
        <div className="st hot"><span>賺到</span><b>+{earned}</b><small>點</small></div>
        <div className="st"><span>完成任務</span><b>{doneAll}</b><small>項{proposals ? ` · 主動 ${proposals}` : ""}</small></div>
        <div className="st"><span>例行完成率</span><b>{rate}%</b><div className="ring"><i style={{ width: `${rate}%` }} /></div></div>
        <div className="st"><span>兌換 · 存入</span><b>{spent}</b><small>點 · 存 {saved}</small></div>
      </div>
      <div className="card"><div className="pack-head"><b>📈 最近 14 天</b><small>每天賺到的點數</small></div>
        <svg className="bars" viewBox="0 0 280 120" role="img" aria-label="最近 14 天每天賺到的點數">
          {perDay.map((v, i) => { const h = Math.max(2, (v / maxV) * 78); return <g key={i}>
            <rect x={i * 20 + 3} y={100 - h} width="14" height={h} rx="4" className={i === 13 ? "today" : i === best && v > 0 ? "best" : ""} style={{ animationDelay: `${i * 30}ms` }}><title>{days[i]}：{v} 點</title></rect>
            {v > 0 && (i === best || i === 13) && <text x={i * 20 + 10} y={95 - h} textAnchor="middle" className="bv">{v}</text>}
            {(i % 2 === 1 || i === 13) && <text x={i * 20 + 10} y="114" textAnchor="middle" className="bl">{i === 13 ? "今" : days[i].slice(8)}</text>}</g>; })}
        </svg>
        {perDay[best] > 0 && <small style={{ color: "var(--muted)", fontSize: 12 }}>🏆 最高的一天是 {pretty(days[best])}，賺了 {perDay[best]} 點</small>}
      </div>
      <h2 className="sec">每日紀錄<small>{V.length} 筆</small></h2>
      {isAdmin && V.some(canEdit) && <p className="edit-hint">✏️ 管理員：點一筆任務或激勵紀錄，可以撤銷誤按的通過、改點數或刪除。</p>}
      {V.length === 0 ? <div className="card empty"><span className="big">🌱</span>這段時間還沒有紀錄</div> :
        [...groups.entries()].map(([d, list]) => { const sum = list.filter((l) => EARN.includes(l.ref_type ?? "")).reduce((a, l) => a + l.amount + (adjOf.get(l.id) ?? 0), 0);
          return <div className="card tl" key={d}><div className="pack-head"><b>{pretty(d)}</b><small>{sum ? `賺 +${sum}` : ""}</small></div>
            {list.map((l) => { const adj = adjOf.get(l.id); const amt = l.amount + (adj ?? 0); const ed = canEdit(l);
              const inner = <><span className="tl-ic">{icon(l)}</span><div className="grow">{l.reason}<small>{new Date(l.created_at).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })} · {l.account === "jar" ? "存錢罐" : "零用包"}{adj ? (amt === 0 ? " · 已刪除" : " · 已修改") : ""}{l.ref_id && rateOf.get(l.ref_id) && l.ref_type === "task" ? ` · ${rateOf.get(l.ref_id)}` : ""}{ed ? " · ✏️" : ""}</small></div><span className={amt >= 0 ? "plus" : "minus"}>{adj ? <span className="was">{l.amount}</span> : null}{amt >= 0 ? "+" : ""}{amt}</span></>;
              const cls = `tl-row${ed ? " editable" : ""}${adj && amt === 0 ? " gone" : ""}`;
              return ed ? <button type="button" className={cls} key={l.id} onClick={() => openEdit(l)} style={{ width: "100%", textAlign: "left" }}>{inner}</button> : <div className={cls} key={l.id}>{inner}</div>; })}</div>; })}
      {V.length > limit && <button className="btn line" onClick={() => setLimit(limit + 60)}>看更早的紀錄</button>}
    </>}
  </>;
}

// 管理員修正一筆紀錄：誤按通過可以撤銷（退回重做或作廢），也可以改點數或刪除
function EditSheet({ l, now, onDone }: { l: Ledger; now: number; onDone: () => void }) {
  const ui = useUi();
  const [task, setTask] = useState<Task | null>(null);
  const [pts, setPts] = useState(String(now));
  const [why, setWhy] = useState("還沒完成，請再做一次");
  const [sure, setSure] = useState<"" | "void" | "del">("");
  useEffect(() => { if (l.ref_type === "task" && l.ref_id) sb.from("tasks").select("*").eq("id", l.ref_id).maybeSingle().then(({ data }) => setTask((data ?? null) as Task | null)); }, [l]);
  const canRedo = task && !task.plan && task.status !== "void" && task.status !== "todo";
  const redo = async (mode: "redo" | "void") => { const r = await ui.busy(rpc<number>("admin_redo_task", { p_task: task!.id, p_mode: mode, p_reason: mode === "redo" ? why : "這項不算" })); if (r !== undefined) { ui.toast(mode === "redo" ? `已退回重做${r ? `，收回 ${r} 點` : ""}` : `已作廢${r ? `，收回 ${r} 點` : ""}`); onDone(); } };
  const save = async (n: number) => { const r = await ui.busy(rpc("admin_edit_ledger", { p_id: l.id, p_amount: n })); if (r !== undefined) { ui.toast(n === 0 ? "已刪除這筆點數" : `已改成 ${n} 點`); onDone(); } };
  return <>
    <h3>修改紀錄</h3>
    <div className="plan-box"><b>{l.reason}</b><br /><small className="hint">{new Date(l.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} · 目前 {now} 點{now !== l.amount ? `（原本 ${l.amount}）` : ""}</small></div>
    {canRedo && <div className="field">誤按通過、其實還沒完成？
      <div className="row">{["還沒完成，請再做一次", "做得不完整", "照片不對"].map((w) => <button key={w} className={`chip ${why === w ? "on" : ""}`} onClick={() => setWhy(w)}>{w}</button>)}</div>
      <button className="btn gold" onClick={() => redo("redo")}>↩️ 撤銷通過，退回重做</button>
      <small className="hint">點數（含全勤獎）會自動收回，任務回到孩子的清單，做完再送一次。</small>
    </div>}
    <label className="field">改成幾點<input type="text" id="ed-pts" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))} /></label>
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button><button className="btn" disabled={pts === "" || Number(pts) === now || Number(pts) > 5000} onClick={() => save(Number(pts))}>儲存點數</button></div>
    <div className="danger-zone">{!sure ? <div className="row">{canRedo && <button className="btn line" onClick={() => setSure("void")}>🚫 作廢這個任務</button>}{now !== 0 && <button className="btn line" onClick={() => setSure("del")}>🗑️ 刪除這筆點數</button>}</div> :
      <><div className="warn">{sure === "void" ? "作廢後這項不算、也不用再做，點數會收回。" : `會把這筆 ${now} 點收回，紀錄會保留並標示「已刪除」。`}孩子會收到通知。</div>
        <div className="row"><button className="btn line" onClick={() => setSure("")}>先不要</button><button className="btn bad" onClick={() => (sure === "void" ? redo("void") : save(0))}>{sure === "void" ? "確定作廢" : "確定刪除"}</button></div></>}</div>
  </>;
}

// 設定 → 點數紀錄後台：所有孩子的點數紀錄，管理員可以調整或刪除
export function LedgerAdmin() {
  const { members } = useStore(); const ui = useUi();
  const kids = members.filter((m) => m.role === "child");
  const [who, setWho] = useState<string>("all");
  const [rows, setRows] = useState<Ledger[] | null>(null);
  const [only, setOnly] = useState(true);
  useEffect(() => {
    setRows(null);
    let q = sb.from("ledger").select("*").order("created_at", { ascending: false }).limit(400);
    if (who !== "all") q = q.eq("member_id", who);
    q.then(({ data }) => setRows((data ?? []) as Ledger[]));
  }, [who]);
  const adjOf = new Map<number, number>();
  (rows ?? []).forEach((l) => { if (l.ref_ledger) adjOf.set(l.ref_ledger, (adjOf.get(l.ref_ledger) ?? 0) + l.amount); });
  const ok = (l: Ledger) => l.account === "spend" && EDITABLE.includes(l.ref_type ?? "");
  const list = (rows ?? []).filter((l) => !l.ref_ledger && (!only || ok(l)));
  const kidName = (id: string) => members.find((m) => m.id === id);
  const open = (l: Ledger) => ui.sheet(<EditSheet l={l} now={netOf(rows ?? [], l)} onDone={() => ui.sheet(<LedgerAdmin />)} />);
  return <>
    <h3>點數紀錄後台</h3>
    <p>點一筆就能撤銷誤按的通過、改點數或刪除。原本的紀錄會保留並標示，孩子會收到通知。</p>
    {kids.length > 1 && <div className="row"><button className={`chip ${who === "all" ? "on" : ""}`} onClick={() => setWho("all")}>全部</button>{kids.map((k) => <button key={k.id} className={`chip ${who === k.id ? "on" : ""}`} onClick={() => setWho(k.id)}>{k.avatar} {k.display_name}</button>)}</div>}
    <div className="seg"><button className={only ? "on" : ""} onClick={() => setOnly(true)}>可調整的</button><button className={!only ? "on" : ""} onClick={() => setOnly(false)}>全部紀錄</button></div>
    {!rows ? <div className="spinner" /> : list.length === 0 ? <div className="card empty">沒有紀錄</div> :
      <div className="la-list">{list.map((l) => { const adj = adjOf.get(l.id); const amt = l.amount + (adj ?? 0); const k = kidName(l.member_id);
        return <button type="button" key={l.id} className="la-row" disabled={!ok(l)} onClick={() => open(l)}>
          <span className="tl-ic">{icon(l)}</span>
          <div className="grow">{l.reason}<small>{kids.length > 1 && k ? `${k.avatar} ${k.display_name} · ` : ""}{new Date(l.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}{adj ? (amt === 0 ? " · 已刪除" : " · 已修改") : ""}{ok(l) ? " · ✏️" : l.account === "jar" ? " · 存錢罐（不能改）" : l.ref_type === "redeem" || l.ref_type === "refund" ? " · 兌換（到待辦處理）" : ""}</small></div>
          <span className={amt >= 0 ? "plus" : "minus"}>{adj ? <span className="was">{l.amount}</span> : null}{amt >= 0 ? "+" : ""}{amt}</span></button>; })}</div>}
  </>;
}
