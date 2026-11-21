import { useEffect, useState } from "react";
import { useStore } from "../store";
import { EmojiPick, useUi } from "../ui/ui";
import { Task, rpc, sb, when } from "../supabase";

export function Errands() {
  const { me, members, tick, refresh } = useStore(); const ui = useUi();
  const [list, setList] = useState<Task[]>([]);
  useEffect(() => { sb.from("tasks").select("*").eq("kind", "errand").gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).order("created_at", { ascending: false }).then(({ data }) => setList((data ?? []) as Task[])); }, [tick]);
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "";
  const open = list.filter((t) => t.status !== "approved"), done = list.filter((t) => t.status === "approved");
  const status = (t: Task) => (t.status === "submitted" ? "等你核准" : t.status === "rejected" ? "已退回" : "進行中");
  return <>
    <h2 className="sec">家庭交辦<small>可以交辦給任何人，也包括爸媽</small></h2>
    <button className="btn" onClick={() => ui.sheet(<ErrandSheet />)}>＋ 新增交辦事項</button>
    {open.length === 0 && <div className="card empty">沒有進行中的交辦</div>}
    {open.map((t) => <div className="card" key={t.id}><div className="rew"><span className="emo">{t.emoji}</span><div className="mid"><b>{t.title}</b>
      <small>{name(t.assignee)}{t.due_at ? ` · 截止 ${new Date(t.due_at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}{t.points ? ` · +${t.points}` : ""}</small></div>
      {t.assignee === me?.id && t.status === "todo" ? <button className="btn sm" onClick={async () => { const r = await ui.busy(rpc("complete_own_errand", { p_task: t.id })); if (r !== undefined) { ui.toast("完成了"); refresh(); } }}>完成</button> : <span className={`tag ${t.status === "submitted" ? "gold" : ""}`}>{status(t)}</span>}</div></div>)}
    {done.length > 0 && <><h2 className="sec">已完成<small>最近 30 天</small></h2><div className="card ledger">{done.map((t) => <div className="l" key={t.id}><div>{t.emoji} {t.title}<small>{name(t.assignee)} · {when(t.decided_at ?? t.created_at)}</small></div><span className="plus">✓</span></div>)}</div></>}
  </>;
}

export function ErrandSheet() {
  const { members, refresh } = useStore(); const ui = useUi();
  const people = members.filter((m) => m.role !== "guest");
  const tomorrow = new Date(Date.now() + 864e5); tomorrow.setHours(20, 0, 0, 0);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [title, setTitle] = useState(""); const [emoji, setEmoji] = useState("📌"); const [who, setWho] = useState(people.find((m) => m.role === "child")?.id ?? people[0]?.id);
  const [due, setDue] = useState(local(tomorrow)); const [pts, setPts] = useState(10);
  const isKid = members.find((m) => m.id === who)?.role === "child";
  return <>
    <h3>交辦家庭事項</h3>
    <label className="field">事項<input type="text" id="e-title" maxLength={40} placeholder="例如：週六前繳午餐費" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <div className="row">{people.map((m) => <button key={m.id} className={`chip ${who === m.id ? "on" : ""}`} onClick={() => setWho(m.id)}>{m.avatar} {m.display_name}</button>)}</div>
    <label className="field">截止時間（前一小時自動提醒）<input type="datetime-local" id="e-due" value={due} onChange={(e) => setDue(e.target.value)} /></label>
    {isKid && <label className="field">完成可得點數：<b style={{ color: "var(--gold)" }}>{pts}</b><input type="range" min={0} max={100} step={5} value={pts} onChange={(e) => setPts(+e.target.value)} /></label>}
    <EmojiPick value={emoji} onChange={setEmoji} />
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" disabled={!title.trim()} onClick={async () => { const r = await ui.busy(rpc("create_errand", { p_title: title, p_emoji: emoji, p_assignee: who, p_due: due ? new Date(due).toISOString() : null, p_points: isKid ? pts : 0 })); if (r !== undefined) { ui.sheet(null); ui.toast("已交辦，對方會收到通知"); refresh(); } }}>交辦</button></div>
  </>;
}
