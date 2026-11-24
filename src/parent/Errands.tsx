import { useEffect, useState } from "react";
import { useStore } from "../store";
import { EmojiPick, useUi } from "../ui/ui";
import { SwipeAction, SwipeRow } from "../ui/Swipe";
import { Task, dueText, rpc, sb, when } from "../supabase";
import { RejectSheet } from "./Queue";
import { RateSheet } from "../ui/Rate";
import { DuePick, twDefault, twToIso } from "../ui/Schedule";
import { Photo } from "../ui/Photo";

export function Errands() {
  const { me, members, tick, refresh } = useStore(); const ui = useUi();
  const [list, setList] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"open" | "done">("open");
  const load = () => sb.from("tasks").select("*").eq("kind", "errand").neq("status", "void").gte("created_at", new Date(Date.now() - 60 * 864e5).toISOString()).order("created_at", { ascending: false }).then(({ data }) => setList((data ?? []) as Task[]));
  useEffect(() => { load(); }, [tick]); // eslint-disable-line
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "";
  const avatar = (id: string) => members.find((m) => m.id === id)?.avatar ?? "🙂";
  const open = list.filter((t) => t.status !== "approved"), done = list.filter((t) => t.status === "approved");
  const isGuest = me?.role === "guest";
  const after = (msg: string) => { ui.toast(msg); load(); refresh(); };

  const actions = (t: Task): { left?: SwipeAction; right?: SwipeAction; more: SwipeAction[] } => {
    const cancel: SwipeAction = { label: "取消交辦", icon: "🗑️", tone: "bad", run: () => confirmCancel(t) };
    const reopen: SwipeAction = { label: "重審", icon: "🔁", tone: "gold", run: () => ui.sheet(<ReopenSheet t={t} onDone={() => after("已打回重做，對方會收到通知")} />) };
    const approve: SwipeAction = { label: "核准", icon: "✅", tone: "good", run: () => ui.sheet(<RateSheet title={t.title} onPick={async (rt) => { ui.sheet(null); const r = await ui.busy(rpc<number>("approve_task", { p_task: t.id, p_rating: rt })); if (r !== undefined) after(r ? `已核准 +${r}` : "已核准"); }} />) };
    const reject: SwipeAction = { label: "退回", icon: "↩️", tone: "bad", run: () => ui.sheet(<RejectSheet title={t.title} onSend={async (why) => { const r = await ui.busy(rpc("decide_task", { p_task: t.id, p_approve: false, p_reason: why })); if (r !== undefined) { ui.sheet(null); after("已退回"); } }} />) };
    const finish: SwipeAction = { label: "我完成了", icon: "✅", tone: "good", run: async () => { const r = await ui.busy(rpc("complete_own_errand", { p_task: t.id })); if (r !== undefined) after("完成了"); } };
    const ack: SwipeAction = { label: "收到", icon: "📬", tone: "acc", run: async () => { const r = await ui.busy(rpc("ack_errand", { p_task: t.id })); if (r !== undefined) after("已確認收到"); } };
    if (isGuest) return { more: [] };
    if (t.status === "submitted") return { right: approve, left: reject, more: [approve, reject, cancel] };
    if (t.status === "approved") return { right: reopen, left: cancel, more: [reopen, cancel] };
    if (t.status === "rejected") return { right: reopen, left: cancel, more: [cancel] };
    if (t.assignee === me?.id) return t.ack_at ? { right: finish, left: cancel, more: [finish, cancel] } : { right: ack, left: cancel, more: [ack, cancel] };
    return { left: cancel, more: [cancel] };
  };
  function confirmCancel(t: Task) {
    ui.dialog(<><h3>取消「{t.title}」？</h3><p>{t.assignee === me?.id ? "這件事會從清單移除。" : `${name(t.assignee)}會收到「不用做了」的通知。`}</p>
      <div className="row"><button className="btn line" onClick={() => ui.dialog(null)}>保留</button><button className="btn bad" onClick={async () => { const r = await ui.busy(rpc("cancel_errand", { p_task: t.id })); ui.dialog(null); if (r !== undefined) after("已取消交辦"); }}>確定取消</button></div></>);
  }
  const status = (t: Task) => t.status === "submitted" ? ["等你核准", "gold"] : t.status === "rejected" ? ["已退回重做", "bad"] : t.status === "approved" ? ["已完成", "ok"] : t.ack_at ? ["已收到，進行中", "ok"] : ["對方未讀", "new"];
  const detail = (t: Task) => { const a = actions(t); ui.sheet(<><h3>{t.emoji} {t.title}</h3>
    <div className="card"><div className="lot"><span>交辦給</span><b>{avatar(t.assignee)} {name(t.assignee)}</b></div>
      <div className="lot"><span>交辦人</span><b>{t.created_by ? name(t.created_by) : "—"}</b></div>
      <div className="lot"><span>截止</span><b>{t.due_at ? dueText(t.due_at) : "沒有截止時間"}</b></div>
      <div className="lot"><span>點數</span><b>{t.points ? `+${t.points}` : "—"}</b></div>
      <div className="lot"><span>狀態</span><span className={`tag ${status(t)[1]}`}>{status(t)[0]}</span></div>
      {t.reject_reason && <div className="lot"><span>備註</span><b>{t.reject_reason}</b></div>}
      {t.photo === "required" && <div className="lot"><span>照片</span><b>完成時必須拍照</b></div>}</div>
    {t.photo_path && <div className="field">📷 完成照片<Photo path={t.photo_path} /></div>}
    {a.more.length > 0 ? <div className="row">{a.more.map((x) => <button key={x.label} className={`btn ${x.tone === "bad" ? "bad" : x.tone === "good" ? "good" : x.tone === "gold" ? "line" : "ghost"}`} onClick={() => { ui.sheet(null); setTimeout(x.run, 60); }}>{x.icon} {x.label}</button>)}</div> : <p>訪客只能查看。</p>}
  </>); };
  const shown = filter === "open" ? open : done;

  return <>
    <h2 className="sec">家庭交辦<small>對方沒按「收到」，每 3 小時提醒一次</small></h2>
    {!isGuest && <button className="btn" onClick={() => ui.sheet(<ErrandSheet />)}>＋ 新增交辦事項</button>}
    <div className="seg"><button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>進行中 {open.length}</button><button className={filter === "done" ? "on" : ""} onClick={() => setFilter("done")}>已完成 {done.length}</button></div>
    {!isGuest && shown.length > 0 && <div className="swipe-hint">👈 左滑{filter === "open" ? "退回、取消" : "移除"} · 右滑{filter === "open" ? "核准、完成" : "重審"} 👉 · 點一下看詳情</div>}
    {shown.length === 0 && <div className="card empty"><span className="big">{filter === "open" ? "🎈" : "📭"}</span>{filter === "open" ? "沒有進行中的交辦" : "最近 60 天沒有完成的交辦"}</div>}
    {shown.map((t, i) => { const a = actions(t); const [txt, cls] = status(t);
      return <SwipeRow key={t.id} left={a.left} right={a.right} onTap={() => detail(t)}>
        <div className={`card ${i === 0 && !isGuest ? "hint-nudge" : ""}`}><div className="rew"><span className="emo">{t.emoji}</span><div className="mid"><b>{t.title}</b>
          <small>{avatar(t.assignee)} {name(t.assignee)}{t.photo_path ? " · 📷" : ""}{t.due_at && t.status !== "approved" ? ` · ${dueText(t.due_at)}` : ""}{t.status === "approved" ? ` · ${when(t.decided_at ?? t.created_at)}` : ""}{t.points ? ` · +${t.points}` : ""}</small></div>
          <span className={`tag ${cls}`}>{txt}</span></div></div>
      </SwipeRow>; })}
  </>;
}

function ReopenSheet({ t, onDone }: { t: Task; onDone: () => void }) {
  const ui = useUi(); const [why, setWhy] = useState("沒有做完整"); const [other, setOther] = useState("");
  return <>
    <h3>🔁 重審：{t.title}</h3><p>交辦會回到「進行中」，對方要重新確認並完成。{t.status === "approved" && t.points ? `已經給的 ${t.points} 點會先收回，完成後再給。` : ""}</p>
    <div className="row">{["沒有做完整", "品質要再加強", "時間改了", "其他"].map((w) => <button key={w} className={`chip ${why === w ? "on" : ""}`} onClick={() => setWhy(w)}>{w}</button>)}</div>
    {why === "其他" && <label className="field">原因<input type="text" id="ro-other" value={other} maxLength={40} onChange={(e) => setOther(e.target.value)} /></label>}
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" onClick={async () => { const r = await ui.busy(rpc("reopen_errand", { p_task: t.id, p_reason: why === "其他" ? other : why })); if (r !== undefined) { ui.sheet(null); onDone(); } }}>打回重做</button></div>
  </>;
}

export function ErrandSheet() {
  const { members, refresh } = useStore(); const ui = useUi();
  const people = members.filter((m) => m.role !== "guest");
  const [title, setTitle] = useState(""); const [emoji, setEmoji] = useState("📌"); const [who, setWho] = useState(people.find((m) => m.role === "child")?.id ?? people[0]?.id);
  const [due, setDue] = useState(twDefault(1, "20:00")); const [pts, setPts] = useState("10"); const [photo, setPhoto] = useState<"optional" | "required">("optional");
  const isKid = members.find((m) => m.id === who)?.role === "child";
  return <>
    <h3>交辦家庭事項</h3>
    <label className="field">事項<input type="text" id="e-title" maxLength={40} placeholder="例如：週六前繳午餐費" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <div className="row">{people.map((m) => <button key={m.id} className={`chip ${who === m.id ? "on" : ""}`} onClick={() => setWho(m.id)}>{m.avatar} {m.display_name}</button>)}</div>
    <DuePick value={due} onChange={setDue} />
    {isKid && <><label className="field">完成可得點數（0 到 5000）<input type="text" id="e-pts" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))} /></label>
      <div className="row">{[10, 50, 100, 500, 1000, 5000].map((n) => <button key={n} className={`chip ${pts === String(n) ? "on" : ""}`} onClick={() => setPts(String(n))}>{n}</button>)}</div>
      {Number(pts) > 5000 && <div className="warn">交辦獎勵最多 5000 點</div>}
      <div className="field">照片佐證<div className="seg"><button className={photo === "optional" ? "on" : ""} onClick={() => setPhoto("optional")}>可附照片</button><button className={photo === "required" ? "on" : ""} onClick={() => setPhoto("required")}>📷 必須拍照</button></div></div></>}
    <EmojiPick value={emoji} onChange={setEmoji} />
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" disabled={!title.trim() || (isKid && Number(pts) > 5000)} onClick={async () => { const r = await ui.busy(rpc("create_errand", { p_title: title, p_emoji: emoji, p_assignee: who, p_due: twToIso(due), p_points: isKid ? Number(pts) || 0 : 0, p_photo: isKid ? photo : "none" })); if (r !== undefined) { ui.sheet(null); ui.toast("已交辦，對方會收到通知"); refresh(); } }}>交辦</button></div>
  </>;
}
