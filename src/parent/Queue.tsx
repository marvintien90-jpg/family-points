import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../ui/ui";
import { Redemption, Task, jarTier, rpc, sb, when, scheduleText, PACKS } from "../supabase";
import type { ParentData } from "./ParentApp";
import { BonusSheet } from "./ParentApp";
import { RateSheet } from "../ui/Rate";

function Photo({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { sb.storage.from("task-photos").createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null)); }, [path]);
  return url ? <img className="q-photo" src={url} alt="任務照片" /> : null;
}

export function Queue({ data }: { data: ParentData }) {
  const { me, members, family } = useStore(); const ui = useUi();
  const isAdmin = me?.role === "admin";
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "";
  const kids = members.filter((m) => m.role === "child");
  const [adj, setAdj] = useState<Record<string, number>>({});
  const bonusPct = Number(family?.settings.proposal_bonus ?? 0.2);

  function approve(t: Task) {
    if (t.plan) { doApprove(t, null); return; }
    ui.sheet(<RateSheet title={t.title} onPick={(rt) => { ui.sheet(null); doApprove(t, rt); }} />);
  }
  async function doApprove(t: Task, rating: string | null) {
    const r = await ui.busy(rpc<number>("approve_task", { p_task: t.id, p_points: adj[t.id] ?? null, p_rating: rating }));
    if (r === undefined) return;
    if (t.plan) { ui.toast("已加入例行任務，可到「任務獎勵」修改"); data.reload(); return; }
    ui.toast(`已核准 +${r}`, async () => { await ui.busy(rpc("undo_task", { p_task: t.id })); ui.toast("已復原"); data.reload(); });
    data.reload();
  }
  function approveAll(list: Task[]) {
    ui.sheet(<RateSheet title={`全部 ${list.length} 項`} sub="同一個評價會套用到這組每一項。" onPick={async (rt) => {
      ui.sheet(null); let total = 0;
      for (const t of list) { const r = await ui.busy(rpc<number>("approve_task", { p_task: t.id, p_rating: rt })); total += r ?? 0; }
      ui.toast(`已全部核准，共 +${total}`); data.reload(); }} />);
  }
  function reject(t: Task) { ui.sheet(<RejectSheet title={t.title} onSend={async (why) => { const r = await ui.busy(rpc("decide_task", { p_task: t.id, p_approve: false, p_reason: why })); if (r !== undefined) { ui.sheet(null); ui.toast("已退回"); data.reload(); } }} />); }
  function decideRed(x: Redemption, ok: boolean) {
    if (!ok) { ui.sheet(<RejectSheet title={x.title} onSend={async (why) => { const r = await ui.busy(rpc("decide_redemption", { p_id: x.id, p_approve: false, p_reason: why })); if (r !== undefined) { ui.sheet(null); ui.toast("已退回，點數還給孩子"); data.reload(); } }} />); return; }
    ui.busy(rpc("decide_redemption", { p_id: x.id, p_approve: true })).then((r) => { if (r !== undefined) { ui.toast("已同意兌換，記得兌現喔"); data.reload(); } });
  }

  const routineGroups = new Map<string, Task[]>();
  data.queue.filter((t) => t.kind === "routine").forEach((t) => { const k = `${t.assignee}|${t.pack ?? ""}`; routineGroups.set(k, [...(routineGroups.get(k) ?? []), t]); });
  const others = data.queue.filter((t) => t.kind !== "routine");
  const empty = data.queue.length === 0 && data.reds.length === 0;

  return <>
    <div className="hero">
      <div className="hero-row"><div className="who"><div className="avatar">{me?.avatar}</div><div><b>{me?.display_name}</b><small>{me?.role === "admin" ? "家長 · 管理員" : "家長"}</small></div></div><span className="lv">待處理 {data.queue.length + data.reds.length}</span></div>
      <div className="wallets">{kids.slice(0, 2).map((k) => { const w = data.wallets[k.id]; return <div className="wallet" key={k.id}><span>{k.avatar} {k.display_name} · Lv {w?.level ?? 1}</span><span className="n">{w?.spend ?? 0}</span><span style={{ fontSize: 11.5 }}>存錢罐 {w?.jar_value ?? 0}（{jarTier(w?.best_days ?? 0)}）</span></div>; })}
        {kids.length === 0 && <div className="wallet"><span>還沒有孩子帳號</span><span style={{ fontSize: 13 }}>到設定新增</span></div>}</div>
    </div>
    {empty && <div className="card empty"><span className="big">☕</span>都處理完了。孩子提交任務時，你的手機會收到通知。</div>}
    {[...routineGroups.values()].map((list) => <div className="card" key={list[0].id}>
      <div className="q-top"><span className="emo">📋</span><div className="mid"><b>{name(list[0].assignee)}的例行清單</b><small>{list.length} 項 · {when(list[list.length - 1].submitted_at ?? list[0].created_at)}</small></div><span className="cost">+{list.reduce((a, t) => a + t.points, 0)}</span></div>
      {list.map((t) => <div key={t.id}>
        <div className="lot"><span>{t.emoji} {t.title} <span className="cost" style={{ fontSize: 14 }}>+{t.points}</span></span>{isAdmin ? <span className="row" style={{ flexWrap: "nowrap" }}><button className="btn line sm" onClick={() => reject(t)}>退回</button><button className="btn good sm" onClick={() => approve(t)}>核准</button></span> : <small className="hint">等管理員審核</small>}</div>
        {t.photo_path && <Photo path={t.photo_path} />}</div>)}
      {isAdmin && list.length > 1 && <button className="btn good" onClick={() => approveAll(list)}>全部核准</button>}
    </div>)}
    {others.map((t) => <div className="card" key={t.id}>
      <div className="q-top"><span className="emo">{t.emoji}</span><div className="mid"><b>{t.title}</b><small>{name(t.assignee)} · {t.plan ? "想加入每日例行" : t.kind === "proposal" ? "主動提案" : "交辦"} · {when(t.submitted_at ?? t.created_at)}</small></div>
        <span className="cost">{t.plan ? `每次 +${adj[t.id] ?? t.points}` : `+${t.kind === "proposal" ? Math.round((adj[t.id] ?? t.points) * (1 + bonusPct)) : adj[t.id] ?? t.points}`}</span></div>
      {t.plan && <><div className="plan-box">📅 {scheduleText(t.plan)}{t.plan.pack && PACKS[t.plan.pack] ? ` · ${PACKS[t.plan.pack].icon} ${PACKS[t.plan.pack].name}` : ""}<br /><small className="hint">核准後會變成例行任務，之後每次做完一樣要你核准才給點。</small></div>
        <label className="field">每次點數 {adj[t.id] ?? t.points}<input type="range" min={1} max={100} value={adj[t.id] ?? t.points} onChange={(e) => setAdj({ ...adj, [t.id]: +e.target.value })} /></label></>}
      {t.kind === "proposal" && !t.plan && <label className="field">核准點數 {adj[t.id] ?? t.points}（另加主動加成 {Math.round(bonusPct * 100)}%）<input type="range" min={5} max={200} step={5} value={adj[t.id] ?? t.points} onChange={(e) => setAdj({ ...adj, [t.id]: +e.target.value })} /></label>}
      {t.photo_path && <Photo path={t.photo_path} />}
      <div className="row"><button className="btn line sm" onClick={() => reject(t)}>退回</button><button className="btn good sm" onClick={() => approve(t)}>{t.plan ? "核准加入例行" : "核准"}</button></div>
    </div>)}
    {data.reds.map((x) => <div className="card" key={x.id}>
      <div className="q-top"><span className="emo">{x.emoji}</span><div className="mid"><b>兌換：{x.title}</b><small>{name(x.member_id)} · 用{x.source === "jar" ? "存錢罐" : "零用包"} · {when(x.created_at)}</small></div><span className="cost">{x.cost}</span></div>
      <div className="row"><button className="btn line sm" onClick={() => decideRed(x, false)}>不同意</button><button className="btn good sm" onClick={() => decideRed(x, true)}>同意兌換</button></div>
    </div>)}
    {kids.length > 0 && <button className="btn ghost" onClick={() => ui.sheet(<BonusSheet onDone={data.reload} />)}>⭐ 給激勵點</button>}
  </>;
}

export function RejectSheet({ title, onSend }: { title: string; onSend: (why: string) => void }) {
  const ui = useUi(); const [why, setWhy] = useState("再做仔細一點"); const [other, setOther] = useState("");
  return <>
    <h3>退回：{title}</h3><p>寫一句原因，孩子會看到，修正後可以再送。</p>
    <div className="row">{["再做仔細一點", "還沒完成喔", "照片看不清楚", "這次先不行", "其他"].map((w) => <button key={w} className={`chip ${why === w ? "on" : ""}`} onClick={() => setWhy(w)}>{w}</button>)}</div>
    {why === "其他" && <label className="field">原因<input type="text" id="rj-other" value={other} onChange={(e) => setOther(e.target.value)} maxLength={40} /></label>}
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button><button className="btn bad" onClick={() => onSend(why === "其他" ? other : why)}>退回</button></div>
  </>;
}
