import { useState } from "react";
import { useStore } from "../store";
import { EmojiPick, useUi } from "../ui/ui";
import { PACKS, Task, dueText, rpc, sb } from "../supabase";
import type { KidData } from "./KidApp";

async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file); const s = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.82));
}

export function Today({ data }: { data: KidData }) {
  const { me, family } = useStore(); const ui = useUi();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const routines = data.tasks.filter((t) => t.kind === "routine");
  const errands = data.tasks.filter((t) => t.kind === "errand" && t.status !== "approved");
  const proposals = data.tasks.filter((t) => t.kind === "proposal");
  const limit = Number(family?.settings.proposal_daily_limit ?? 3);
  const today = new Date().toDateString();
  const usedToday = proposals.filter((p) => new Date(p.created_at).toDateString() === today).length;

  const toggle = (t: Task) => { if (t.status !== "todo" && t.status !== "rejected") return; const n = new Set(picked); n.has(t.id) ? n.delete(t.id) : n.add(t.id); setPicked(n); };

  async function submit(ids: string[]) {
    const needPhoto = data.tasks.some((t) => ids.includes(t.id) && t.photo === "required");
    const canPhoto = data.tasks.some((t) => ids.includes(t.id) && t.photo !== "none");
    if (canPhoto) { ui.sheet(<PhotoSheet required={needPhoto} onDone={async (path) => { ui.sheet(null); await send(ids, path); }} />); return; }
    await send(ids, null);
  }
  async function send(ids: string[], photo: string | null) {
    const r = await ui.busy(rpc("submit_tasks", { p_ids: ids, p_photo: photo }));
    if (r !== undefined) { setPicked(new Set()); ui.toast("已送出，等爸媽核准"); data.reload(); }
  }

  return <>
    <h2 className="sec">例行清單<small>一整組都完成再 +{String(family?.settings.pack_bonus ?? 10)} 全勤獎</small></h2>
    {routines.length === 0 && <div className="card empty">今天沒有例行任務</div>}
    {(["am", "pm", "bed"] as const).map((pk) => {
      const items = routines.filter((t) => t.pack === pk); if (!items.length) return null;
      const sel = items.filter((t) => picked.has(t.id)); const done = items.filter((t) => t.status === "submitted" || t.status === "approved").length;
      return <div className="card" key={pk}>
        <div className="pack-head"><b>{PACKS[pk].icon} {PACKS[pk].name}</b><small>{done === items.length && items.every((t) => t.status === "approved") ? "全部完成 🎉" : `${PACKS[pk].time} · ${done}/${items.length}`}</small></div>
        {items.map((t) => <TaskRow key={t.id} t={t} picked={picked.has(t.id)} onClick={() => toggle(t)} />)}
        {sel.length > 0 && <button className="btn" onClick={() => submit(sel.map((t) => t.id))}>提交 {sel.length} 項給爸媽</button>}
      </div>;
    })}
    {routines.some((t) => !t.pack) && <div className="card"><div className="pack-head"><b>其他</b></div>
      {routines.filter((t) => !t.pack).map((t) => <TaskRow key={t.id} t={t} picked={picked.has(t.id)} onClick={() => toggle(t)} />)}
      {routines.some((t) => !t.pack && picked.has(t.id)) && <button className="btn" onClick={() => submit(routines.filter((t) => !t.pack && picked.has(t.id)).map((t) => t.id))}>提交給爸媽</button>}
    </div>}

    <h2 className="sec">家裡交辦給我<small>{errands.length} 件</small></h2>
    {errands.length ? errands.map((t) => <div className="card" key={t.id}><div className="rew"><span className="emo">{t.emoji}</span><div className="mid"><b>{t.title}</b>
      <small>{t.status === "submitted" ? "⏳ 等待核准" : t.status === "rejected" ? `被退回：${t.reject_reason}` : t.due_at ? `截止 ${dueText(t.due_at)}` : "沒有截止時間"}{t.points ? ` · +${t.points}` : ""}</small></div>
      {t.status === "todo" && !t.ack_at ? <button className="btn sm ghost" onClick={async () => { const r = await ui.busy(rpc("ack_errand", { p_task: t.id })); if (r !== undefined) { ui.toast("已告訴爸媽你收到了"); data.reload(); } }}>收到</button>
        : (t.status === "todo" || t.status === "rejected") && <button className="btn sm" onClick={() => submit([t.id])}>完成</button>}</div></div>)
      : <div className="card empty">目前沒有交辦事項</div>}

    <h2 className="sec">主動任務<small>今天還能提案 {Math.max(0, limit - usedToday)} 次</small></h2>
    <div className="card">
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>自己想到可以幫忙或挑戰的事？提案給爸媽，核准後多 <b style={{ color: "var(--gold)" }}>{Math.round(Number(family?.settings.proposal_bonus ?? 0.2) * 100)}%</b> 主動加成。</p>
      {proposals.slice(-3).reverse().map((t) => <div className="lot" key={t.id}><span>{t.emoji} {t.title}</span><span className={`tag ${t.status === "approved" ? "gold" : t.status === "rejected" ? "bad" : ""}`}>{t.status === "approved" ? "已核准" : t.status === "rejected" ? `退回：${t.reject_reason}` : "等待中"}</span></div>)}
      <button className="btn ghost" disabled={usedToday >= limit} onClick={() => ui.sheet(<ProposeSheet onDone={() => { ui.sheet(null); data.reload(); }} />)}>＋ 提案一個主動任務</button>
    </div>
    {me && null}
  </>;
}

function TaskRow({ t, picked, onClick }: { t: Task; picked: boolean; onClick: () => void }) {
  const cls = t.status === "approved" ? "ok" : t.status === "submitted" ? "sub" : picked ? "done" : "";
  return <button className={`item ${cls}`} onClick={onClick} aria-pressed={picked} aria-disabled={t.status === "submitted" || t.status === "approved"}>
    <span className="chk" /><span className="emo">{t.emoji}</span>
    <span className="t">{t.title}{t.status === "submitted" && <small>等待核准</small>}{t.status === "rejected" && <small className="bad">退回：{t.reject_reason}</small>}{t.photo === "required" && t.status === "todo" && <small>📷 需要拍照</small>}</span>
    <span className="p">+{t.points}</span>
  </button>;
}

function PhotoSheet({ required, onDone }: { required: boolean; onDone: (path: string | null) => void }) {
  const { family } = useStore(); const ui = useUi(); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<string | null>(null); const [file, setFile] = useState<File | null>(null);
  async function go() {
    if (!file) { onDone(null); return; }
    setBusy(true);
    try {
      const blob = await shrink(file); const path = `${family!.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from("task-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error; onDone(path);
    } catch (e) { ui.toast(`照片上傳失敗：${e instanceof Error ? e.message : e}`); } finally { setBusy(false); }
  }
  return <>
    <h3>{required ? "拍一張照片當證明" : "要附照片嗎？"}</h3>
    <p>{required ? "這個任務需要照片，爸媽看了才能核准。" : "可以拍一張給爸媽看，也可以直接送出。"}</p>
    {preview && <img className="q-photo" src={preview} alt="預覽" />}
    <label className="btn ghost">📷 {preview ? "重拍" : "拍照或選照片"}<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPreview(URL.createObjectURL(f)); } }} /></label>
    <div className="row"><button className="btn" disabled={busy || (required && !file)} onClick={go}>{busy ? "上傳中…" : "送出"}</button></div>
  </>;
}

function ProposeSheet({ onDone }: { onDone: () => void }) {
  const ui = useUi(); const [title, setTitle] = useState(""); const [emoji, setEmoji] = useState("🌱"); const [pts, setPts] = useState(30);
  return <>
    <h3>提案主動任務</h3><p>說說你想做什麼、建議幾點。爸媽可能會調整點數。</p>
    <label className="field">要做什麼<input type="text" id="p-title" maxLength={30} placeholder="例如：幫忙洗碗一週" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <EmojiPick value={emoji} onChange={setEmoji} />
    <label className="field">建議點數：<b style={{ color: "var(--gold)" }}>{pts}</b><input type="range" id="p-pts" min={5} max={100} step={5} value={pts} onChange={(e) => setPts(+e.target.value)} /></label>
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" disabled={!title.trim()} onClick={async () => { const r = await ui.busy(rpc("propose_task", { p_title: title, p_emoji: emoji, p_points: pts })); if (r !== undefined) { ui.toast("提案送出了！"); onDone(); } }}>送出提案</button></div>
  </>;
}
