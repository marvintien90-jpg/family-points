import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { useUi } from "./ui/ui";
import { PACKS, Task, dueText, rpc, sb, timeOf, todayTW } from "./supabase";

// 打開 App 時先跳出今日待辦，以及最近要到期的交辦
export function useDailyBrief(goTab: (t: string) => void) {
  const { me } = useStore(); const ui = useUi();
  const hiddenAt = useRef<number | null>(null); const shown = useRef(false);
  useEffect(() => {
    if (!me || me.role === "guest") return;
    const show = () => ui.sheet(<BriefSheet goTab={goTab} />);
    if (!shown.current) { shown.current = true; setTimeout(show, 450); }
    const vis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 60 * 60e3) { hiddenAt.current = null; show(); }
    };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [me?.id]); // eslint-disable-line
}

function BriefSheet({ goTab }: { goTab: (t: string) => void }) {
  const { me, members } = useStore(); const ui = useUi();
  const [d, setD] = useState<{ routines: Task[]; errands: Task[]; family: Task[]; approvals: number; reds: number } | null>(null);
  const kid = me?.role === "child";
  const load = async () => {
    if (!me) return;
    if (kid) await rpc("ensure_today").catch(() => {});
    const [r, e, q, x] = await Promise.all([
      sb.from("tasks").select("*").eq("assignee", me.id).eq("kind", "routine").neq("status", "void").eq("for_date", todayTW()).order("created_at"),
      sb.from("tasks").select("*").eq("kind", "errand").not("status", "in", "(approved,void)").order("due_at", { ascending: true, nullsFirst: false }),
      kid ? Promise.resolve({ count: 0 }) : sb.from("tasks").select("id", { count: "exact", head: true }).eq("status", "submitted"),
      kid ? Promise.resolve({ count: 0 }) : sb.from("redemptions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const all = (e.data ?? []) as Task[];
    setD({ routines: ((r.data ?? []) as Task[]).filter((t) => t.status === "todo" || t.status === "rejected").sort((a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9")), errands: all.filter((t) => t.assignee === me.id), family: all, approvals: q.count ?? 0, reds: x.count ?? 0 });
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  if (!d || !me) return <div className="spinner" />;
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "";
  const pool = kid ? d.errands : d.family;
  const next = pool.filter((t) => t.due_at && t.status !== "submitted").sort((a, b) => +new Date(a.due_at!) - +new Date(b.due_at!))[0];
  const unread = d.errands.filter((t) => t.status === "todo" && !t.ack_at);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", hour12: false }).format(new Date()));
  const hi = hour < 11 ? "早安" : hour < 18 ? "午安" : "晚安";
  const ack = async (t: Task) => { const r = await ui.busy(rpc("ack_errand", { p_task: t.id })); if (r !== undefined) { ui.toast("已確認收到"); load(); } };
  const nothing = !d.routines.length && !d.errands.length && !d.approvals && !d.reds && !next;
  const go = (t: string) => { ui.sheet(null); setTimeout(() => goTab(t), 50); };

  return <div className="brief">
    <h3>{hi}，{me.display_name} {me.avatar}</h3>
    <span className="greet">{new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "long" })} · 今日待辦</span>
    <div className="stat">
      {kid ? <><div className={d.routines.length ? "hot" : ""}><b>{d.routines.length}</b>例行未完成</div><div className={unread.length ? "hot" : ""}><b>{d.errands.length}</b>交辦給我</div><div><b>{unread.length}</b>還沒確認</div></>
        : <><div className={d.approvals ? "hot" : ""}><b>{d.approvals}</b>等你核准</div><div className={d.reds ? "hot" : ""}><b>{d.reds}</b>兌換申請</div><div className={d.errands.length ? "hot" : ""}><b>{d.errands.length}</b>交辦給我</div></>}
    </div>
    {next && <div className="next"><span className="emo">{next.emoji}</span><div style={{ flex: 1, minWidth: 0 }}><small>最近要到期</small><b>{next.title}</b><small>{next.assignee === me.id ? "交辦給你" : `交辦給${name(next.assignee)}`}{next.ack_at ? "" : " · 還沒確認"}</small></div><span className="when">{dueText(next.due_at!)}</span></div>}
    {unread.length > 0 && <div className="card"><b style={{ fontSize: 14 }}>📬 新的交辦，請按「收到」</b><div className="brief-list">{unread.map((t) => <div className="li" key={t.id}><span>{t.emoji}</span><div className="grow">{t.title}<small>{t.created_by ? `${name(t.created_by)}交辦` : ""}{t.due_at ? ` · ${dueText(t.due_at)}` : ""}</small></div><button className="btn sm ghost" onClick={() => ack(t)}>收到</button></div>)}</div></div>}
    {kid && d.routines.length > 0 && <div className="card"><b style={{ fontSize: 14 }}>📋 今天還要做</b><div className="brief-list">{d.routines.slice(0, 6).map((t) => <div className="li" key={t.id}><span>{t.emoji}</span><div className="grow">{t.title}<small>{t.due_at ? "⏰ " + timeOf(t.due_at) : t.pack ? PACKS[t.pack].name + " · " + PACKS[t.pack].time : ""}{t.status === "rejected" ? " · 被退回，再試一次" : ""}</small></div><span className="cost" style={{ fontSize: 14 }}>+{t.points}</span></div>)}
      {d.routines.length > 6 && <div className="li"><small>還有 {d.routines.length - 6} 項</small></div>}</div></div>}
    {!kid && d.errands.filter((t) => t.ack_at && t.status === "todo").length > 0 && <div className="card"><b style={{ fontSize: 14 }}>📌 交辦給你的事</b><div className="brief-list">{d.errands.filter((t) => t.ack_at && t.status === "todo").map((t) => <div className="li" key={t.id}><span>{t.emoji}</span><div className="grow">{t.title}<small>{t.due_at ? dueText(t.due_at) : "沒有截止時間"}</small></div></div>)}</div></div>}
    {nothing && <div className="empty"><span className="big">🌤️</span>今天目前沒有待辦，好好休息。</div>}
    <div className="row">
      {kid ? <button className="btn" onClick={() => go("today")}>開始今天的任務</button>
        : <><button className="btn line" onClick={() => go("errands")}>看交辦</button><button className="btn" onClick={() => go("queue")}>{d.approvals + d.reds ? `去核准 ${d.approvals + d.reds} 項` : "知道了"}</button></>}
    </div>
  </div>;
}
