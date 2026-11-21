import { useEffect, useState } from "react";
import { useStore } from "../store";
import { EmojiPick, useUi } from "../ui/ui";
import { PACKS, Reward, TIER, Template, rpc, sb } from "../supabase";

const DAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function Manage() {
  const { members, tick, refresh } = useStore(); const ui = useUi();
  const [tpls, setTpls] = useState<Template[]>([]); const [rews, setRews] = useState<Reward[]>([]);
  useEffect(() => {
    sb.from("task_templates").select("*").order("sort").order("created_at").then(({ data }) => setTpls((data ?? []) as Template[]));
    sb.from("rewards").select("*").order("cost").then(({ data }) => setRews((data ?? []) as Reward[]));
  }, [tick]);
  const kids = members.filter((m) => m.role === "child");
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "";
  const editT = (t?: Template) => ui.sheet(<TemplateSheet t={t} onDone={() => { ui.sheet(null); refresh(); }} />);
  const editR = (r?: Reward) => ui.sheet(<RewardSheet r={r} onDone={() => { ui.sheet(null); refresh(); }} />);

  return <>
    <h2 className="sec">例行任務<small>點一下可以修改或刪除</small></h2>
    {kids.length === 0 && <div className="card empty">先到「設定 → 家庭成員」新增孩子帳號，預設任務會自動建立。</div>}
    {([...Object.keys(PACKS), ""] as string[]).map((pk) => {
      const list = tpls.filter((t) => (t.pack ?? "") === pk); if (!list.length) return null;
      return <div className="card" key={pk || "none"}><div className="pack-head"><b>{pk ? `${PACKS[pk].icon} ${PACKS[pk].name}` : "其他"}</b><small>{pk ? PACKS[pk].time : ""}</small></div>
        {list.map((t) => <button className="rew" key={t.id} style={{ textAlign: "left", opacity: t.active ? 1 : 0.45 }} onClick={() => editT(t)}><span className="emo" style={{ width: 40, height: 40, fontSize: 22 }}>{t.emoji}</span>
          <div className="mid"><b>{t.title}</b><small>{kids.length > 1 ? name(t.assignee) + " · " : ""}{t.days.length === 7 ? "每天" : t.days.map((d) => DAYS[d]).join("")}{t.photo === "required" ? " · 需拍照" : t.photo === "optional" ? " · 可拍照" : ""}{t.active ? "" : " · 已停用"}</small></div><span className="cost">+{t.points}</span></button>)}</div>;
    })}
    {kids.length > 0 && <button className="btn ghost" onClick={() => editT()}>＋ 新增例行任務</button>}

    <h2 className="sec">獎勵商店<small>點一下可以修改或刪除</small></h2>
    {(["small", "medium", "large"] as const).map((tier) => { const list = rews.filter((r) => r.tier === tier); if (!list.length) return null;
      return <div className="card" key={tier}><div className="pack-head"><b>{TIER[tier].name}</b><small>{TIER[tier].hint}</small></div>
        {list.map((r) => <button className="rew" key={r.id} style={{ textAlign: "left", opacity: r.active ? 1 : 0.45 }} onClick={() => editR(r)}><span className="emo" style={{ width: 40, height: 40, fontSize: 22 }}>{r.emoji}</span><div className="mid"><b>{r.title}</b><small>{r.active ? "上架中" : "已下架"}</small></div><span className="cost">{r.cost}</span></button>)}</div>; })}
    <button className="btn ghost" onClick={() => editR()}>＋ 新增獎勵</button>
  </>;
}

function DeleteZone({ label, onDelete }: { label: string; onDelete: () => Promise<void> }) {
  const [sure, setSure] = useState(false);
  return <div className="danger-zone">{!sure ? <button className="btn line" onClick={() => setSure(true)}>🗑️ 刪除{label}</button> :
    <><div className="warn">確定要刪除「{label}」嗎？刪除後無法復原，已經得到的點數和紀錄會保留。</div>
      <div className="row"><button className="btn line" onClick={() => setSure(false)}>先不要</button><button className="btn bad" onClick={onDelete}>確定刪除</button></div></>}</div>;
}

function TemplateSheet({ t, onDone }: { t?: Template; onDone: () => void }) {
  const { members } = useStore(); const ui = useUi(); const kids = members.filter((m) => m.role === "child");
  const [f, setF] = useState({ id: t?.id ?? "", assignee: t?.assignee ?? kids[0]?.id, title: t?.title ?? "", emoji: t?.emoji ?? "✅", points: t?.points ?? 5, pack: (t ? t.pack : "pm") as Template["pack"], days: t?.days ?? [0, 1, 2, 3, 4, 5, 6], photo: t?.photo ?? "none", active: t?.active ?? true });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return <>
    <h3>{t ? "修改例行任務" : "新增例行任務"}</h3>
    <label className="field">任務名稱<input type="text" id="t-title" maxLength={30} value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
    {kids.length > 1 && <div className="row">{kids.map((k) => <button key={k.id} className={`chip ${f.assignee === k.id ? "on" : ""}`} onClick={() => set({ assignee: k.id })}>{k.avatar} {k.display_name}</button>)}</div>}
    <label className="field">點數：<b style={{ color: "var(--gold)" }}>{f.points}</b><input type="range" min={1} max={50} value={f.points} onChange={(e) => set({ points: +e.target.value })} /></label>
    <div className="field">時段<div className="row">{Object.entries(PACKS).map(([k, p]) => <button key={k} className={`chip ${f.pack === k ? "on" : ""}`} onClick={() => set({ pack: k as Template["pack"] })}>{p.icon} {p.name}</button>)}</div></div>
    <div className="field">哪幾天<div className="days">{DAYS.map((d, i) => <button key={i} className={f.days.includes(i) ? "on" : ""} onClick={() => set({ days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })}>{d}</button>)}</div></div>
    <div className="field">照片<div className="row">{([["none", "不需要"], ["optional", "可附"], ["required", "必須"]] as const).map(([k, l]) => <button key={k} className={`chip ${f.photo === k ? "on" : ""}`} onClick={() => set({ photo: k })}>{l}</button>)}</div></div>
    <EmojiPick value={f.emoji} onChange={(e) => set({ emoji: e })} />
    {t && <div className="set-row"><div>啟用<small>暫時不用可以先停用，不需要了就刪除</small></div><button className={`switch ${f.active ? "on" : ""}`} role="switch" aria-checked={f.active} aria-label="啟用" onClick={() => set({ active: !f.active })} /></div>}
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" disabled={!f.title.trim() || f.days.length === 0} onClick={async () => { const r = await ui.busy(rpc("save_template", { p: f })); if (r !== undefined) { ui.toast("已儲存"); onDone(); } }}>儲存</button></div>
    {t && <DeleteZone label={t.title} onDelete={async () => { const r = await ui.busy(rpc("delete_template", { p_id: t.id })); if (r !== undefined) { ui.toast("已刪除"); onDone(); } }} />}
  </>;
}

function RewardSheet({ r, onDone }: { r?: Reward; onDone: () => void }) {
  const ui = useUi();
  const [f, setF] = useState({ id: r?.id ?? "", title: r?.title ?? "", emoji: r?.emoji ?? "🎁", cost: r?.cost ?? 100, tier: r?.tier ?? "small", active: r?.active ?? true });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return <>
    <h3>{r ? "修改獎勵" : "新增獎勵"}</h3>
    <label className="field">獎勵名稱<input type="text" id="r-title" maxLength={30} value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
    <label className="field">需要點數<input type="number" id="r-cost" min={1} max={100000} inputMode="numeric" value={f.cost} onChange={(e) => set({ cost: Math.max(1, +e.target.value || 1) })} /></label>
    <div className="field">等級<div className="row">{(["small", "medium", "large"] as const).map((k) => <button key={k} className={`chip ${f.tier === k ? "on" : ""}`} onClick={() => set({ tier: k })}>{TIER[k].name}</button>)}</div><small>{TIER[f.tier].hint}</small></div>
    <EmojiPick value={f.emoji} onChange={(e) => set({ emoji: e })} />
    {r && <div className="set-row"><div>上架</div><button className={`switch ${f.active ? "on" : ""}`} role="switch" aria-checked={f.active} aria-label="上架" onClick={() => set({ active: !f.active })} /></div>}
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" disabled={!f.title.trim()} onClick={async () => { const x = await ui.busy(rpc("save_reward", { p: f })); if (x !== undefined) { ui.toast("已儲存"); onDone(); } }}>儲存</button></div>
    {r && <DeleteZone label={r.title} onDelete={async () => { const x = await ui.busy(rpc("delete_reward", { p_id: r.id })); if (x !== undefined) { ui.toast("已刪除"); onDone(); } }} />}
  </>;
}
