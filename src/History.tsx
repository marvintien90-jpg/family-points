import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { Ledger, Redemption, Task, sb } from "./supabase";

const EARN = ["task", "pack", "bonus", "interest", "deposit_bonus", "undo"];
const dayTW = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(iso));
const pretty = (d: string) => { const t = dayTW(new Date()), y = dayTW(new Date(Date.now() - 864e5)); if (d === t) return "今天"; if (d === y) return "昨天"; const x = new Date(d + "T12:00:00+08:00"); return x.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" }); };
const icon = (l: Ledger) => l.ref_type === "pack" ? "🏅" : l.ref_type === "bonus" ? "⭐" : l.ref_type === "interest" ? "🪙" : l.ref_type === "redeem" ? "🎁" : l.ref_type === "refund" ? "↩️" : l.ref_type === "undo" ? "⏪" : l.ref_type?.startsWith("deposit") ? "🫙" : l.ref_type === "withdraw" ? "🫙" : "✅";

// 歷史回顧：點數趨勢、完成率、每天發生的事
export function History() {
  const { me, members } = useStore();
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
  }, [who, start, chartStart]);

  if (!isKid && kids.length === 0) return <><h2 className="sec">歷史回顧</h2><div className="card empty"><span className="big">📖</span>新增孩子之後，這裡會整理每週的努力和點數變化。</div></>;

  const inRange = (iso: string) => new Date(iso) >= start;
  const L = (data?.ledger ?? []).filter((l) => inRange(l.created_at));
  const earned = L.filter((l) => EARN.includes(l.ref_type ?? "")).reduce((a, l) => a + l.amount, 0);
  const spent = L.filter((l) => l.ref_type === "redeem" || l.ref_type === "refund").reduce((a, l) => a - l.amount, 0);
  const saved = L.filter((l) => l.ref_type === "deposit" && l.account === "jar").reduce((a, l) => a + l.amount, 0);
  const T = (data?.tasks ?? []).filter((t) => inRange(t.created_at) || (t.for_date && new Date(t.for_date + "T12:00:00+08:00") >= start));
  const routines = T.filter((t) => t.kind === "routine" && t.for_date && t.for_date <= dayTW(new Date()));
  const doneR = routines.filter((t) => t.status === "approved").length;
  const rate = routines.length ? Math.round((doneR / routines.length) * 100) : 0;
  const doneAll = T.filter((t) => t.status === "approved").length;
  const proposals = T.filter((t) => t.kind === "proposal" && t.status === "approved").length;

  // 14 天趨勢
  const days = Array.from({ length: 14 }, (_, i) => dayTW(new Date(chartStart.getTime() + i * 864e5 + 3600e3)));
  const perDay = days.map((d) => (data?.ledger ?? []).filter((l) => EARN.includes(l.ref_type ?? "") && dayTW(l.created_at) === d).reduce((a, l) => a + l.amount, 0));
  const maxV = Math.max(10, ...perDay); const best = perDay.indexOf(Math.max(...perDay));

  // 時間軸
  const groups = new Map<string, Ledger[]>();
  L.slice(0, limit).forEach((l) => { const d = dayTW(l.created_at); groups.set(d, [...(groups.get(d) ?? []), l]); });
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
      <h2 className="sec">每日紀錄<small>{L.length} 筆</small></h2>
      {L.length === 0 ? <div className="card empty"><span className="big">🌱</span>這段時間還沒有紀錄</div> :
        [...groups.entries()].map(([d, list]) => { const sum = list.filter((l) => EARN.includes(l.ref_type ?? "")).reduce((a, l) => a + l.amount, 0);
          return <div className="card tl" key={d}><div className="pack-head"><b>{pretty(d)}</b><small>{sum ? `賺 +${sum}` : ""}</small></div>
            {list.map((l) => <div className="tl-row" key={l.id}><span className="tl-ic">{icon(l)}</span><div className="grow">{l.reason}<small>{new Date(l.created_at).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })} · {l.account === "jar" ? "存錢罐" : "零用包"}</small></div><span className={l.amount >= 0 ? "plus" : "minus"}>{l.amount >= 0 ? "+" : ""}{l.amount}</span></div>)}</div>; })}
      {L.length > limit && <button className="btn line" onClick={() => setLimit(limit + 60)}>看更早的紀錄</button>}
    </>}
  </>;
}
