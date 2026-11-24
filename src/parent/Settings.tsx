import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../ui/ui";
import { Member, PACKS, PACK_DEFAULT, Role, adminCall, rpc, sb } from "../supabase";
import { VERSION, CHANGELOG } from "../changelog";
import { LedgerAdmin } from "../History";
import { enablePush, isIOS, isStandalone, pushPermission } from "../push";

const ROLE: Record<Role, string> = { admin: "管理員", parent: "家長（操作者）", child: "孩子", guest: "訪客" };
const ROLE_CAN: Record<Role, string> = {
  admin: "全部權限：核准任務、給點數、交辦、改任務和獎勵，還能管理成員帳號、授權身份、改點數規則",
  parent: "日常操作：核准任務和兌換、給激勵點、交辦、修改任務和獎勵；不能管理成員和規則",
  guest: "只能看，不能核准、給點數或修改任何東西（適合爺爺奶奶、保母）",
  child: "完成任務、提案、存錢、兌換獎勵",
};
function RolePick({ value, onChange, roles }: { value: Role; onChange: (r: Role) => void; roles: Role[] }) {
  return <div className="role-pick">{roles.map((r) => <button key={r} className={`role-opt ${value === r ? "on" : ""}`} onClick={() => onChange(r)} aria-pressed={value === r}>
    <b>{r === "admin" ? "🛡️" : r === "parent" ? "🧑‍🔧" : r === "guest" ? "👀" : "🧒"} {ROLE[r]}</b><small>{ROLE_CAN[r]}</small></button>)}</div>;
}
const AVATARS = ["👨", "👩", "👦", "👧", "🧒", "🦊", "🐼", "🐯", "🐰", "🐻", "👴", "👵"];

export function Settings() {
  const { me, members, family, refresh } = useStore(); const ui = useUi();
  const [perm, setPerm] = useState(pushPermission());
  const isAdmin = me?.role === "admin";
  return <>
    <h2 className="sec">手機通知</h2>
    <div className="card steps">
      <div className={`step ${isStandalone() ? "done" : ""}`}><span className="dot">1</span>{isIOS() ? "在 Safari 按「分享 → 加入主畫面」" : "安裝到主畫面（建議）"}</div>
      <div className={`step ${perm === "granted" ? "done" : ""}`}><span className="dot">2</span>從主畫面打開，按下方按鈕允許通知</div>
      <div className="row">
        <button className="btn sm" disabled={perm === "granted"} onClick={async () => { const r = await ui.busy(enablePush(me!.id).then(() => true)); setPerm(pushPermission()); if (r) ui.toast("通知已開啟"); }}>{perm === "granted" ? "通知已開啟" : "開啟通知"}</button>
      </div>
      {perm === "denied" && <div className="warn">通知被關掉了。請到 iPhone「設定 → 通知 → 點點樂」打開。</div>}
    </div>

    <h2 className="sec">家庭成員與授權<small>{isAdmin ? "點「管理」可以改身份" : family?.name}</small></h2>
    <div className="card">{members.map((m) => <div className="rew" key={m.id}><span className="emo" style={{ width: 40, height: 40, fontSize: 22 }}>{m.avatar}</span>
      <div className="mid"><b>{m.display_name}{m.id === me?.id ? "（我）" : ""}</b><small><span className={`tag role-${m.role}`}>{ROLE[m.role]}</span> 帳號 {m.login_id}</small></div>
      {isAdmin && m.id !== me?.id && <button className="btn line sm" onClick={() => ui.sheet(<MemberSheet m={m} />)}>管理</button>}</div>)}
      {isAdmin && <button className="btn ghost" onClick={() => ui.sheet(<NewMemberSheet onDone={() => { ui.sheet(null); refresh(); }} />)}>＋ 新增成員</button>}
      <button className="link" onClick={() => ui.sheet(<><h3>各身份可以做什麼</h3>{(["admin", "parent", "guest", "child"] as Role[]).map((r) => <div className="card" key={r}><b>{ROLE[r]}</b><p>{ROLE_CAN[r]}</p></div>)}</>)}>各身份可以做什麼？</button>
    </div>

    {isAdmin && <><h2 className="sec">點數紀錄後台<small>只有管理員</small></h2>
      <div className="card"><p style={{ margin: 0, fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>誤按入點、點數給錯？這裡列出所有孩子的點數紀錄，可以撤銷通過、改點數或刪除。</p>
        <button className="btn ghost" onClick={() => ui.sheet(<LedgerAdmin />)}>🧾 調整點數紀錄</button></div></>}

    {isAdmin && <Rules />}
    {isAdmin && <LineSetup />}

    <h2 className="sec">我的資料</h2>
    <div className="card"><button className="btn line" onClick={() => ui.sheet(<ProfileSheet />)}>修改稱呼和頭像</button><button className="btn line" onClick={() => sb.auth.signOut()}>登出</button></div>
    <h2 className="sec">版本與優化紀錄</h2>
    <div className="card"><div className="set-row"><div>目前版本<small>{CHANGELOG[0].date} 更新</small></div><b className="ver">v{VERSION}</b></div>
      <button className="btn line" onClick={() => ui.sheet(<ChangelogSheet />)}>📝 看優化紀錄</button></div>
    <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>家庭點點樂 v{VERSION} · 資料存在雲端，筆電關機也照常運作</p>
  </>;
}

function Rules() {
  const { family, refresh } = useStore(); const ui = useUi(); const s = family?.settings ?? {};
  const [f, setF] = useState({ deposit_bonus: Number(s.deposit_bonus ?? 0.05) * 100, interest_rate: Number(s.interest_rate ?? 0.02) * 100, interest_cap: Number(s.interest_cap ?? 30), proposal_bonus: Number(s.proposal_bonus ?? 0.2) * 100, proposal_daily_limit: Number(s.proposal_daily_limit ?? 3), pack_bonus: Number(s.pack_bonus ?? 10), pack_am: String(s.pack_am ?? PACK_DEFAULT.am), pack_pm: String(s.pack_pm ?? PACK_DEFAULT.pm), pack_bed: String(s.pack_bed ?? PACK_DEFAULT.bed), quiet_start: String(s.quiet_start ?? "21:30"), quiet_end: String(s.quiet_end ?? "07:00"), streak7_bonus: Number(s.streak7_bonus ?? 30), streak30_bonus: Number(s.streak30_bonus ?? 150), deduct_daily_cap: Number(s.deduct_daily_cap ?? 50), deduct_reasons: String(s.deduct_reasons ?? "沒收拾房間、說話沒禮貌、拖拉超過時間、忘記寫功課、吵架動手"), interest_on: Number(s.interest_on ?? 1), report_on: Number(s.report_on ?? 1) });
  const toggle = (k: "interest_on" | "report_on", label: string, hint: string) => <div className="set-row"><div>{label}<small>{hint}</small></div><button type="button" id={`rule-${k}`} role="switch" aria-checked={!!f[k]} className={`switch ${f[k] ? "on" : ""}`} onClick={() => setF({ ...f, [k]: f[k] ? 0 : 1 })} /></div>;
  const num = (k: keyof typeof f, label: string, unit: string) => <label className="field">{label}<input type="text" inputMode="decimal" id={`rule-${k}`} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, "") as unknown as number })} /><small>{unit}</small></label>;
  return <><h2 className="sec">點數規則<small>只有管理員能改</small></h2>
    <div className="card">
      <div className="field">例行任務各時段的完成時間<div className="row">{(["am", "pm", "bed"] as const).map((k) => <label key={k} className="field" style={{ flex: 1, minWidth: 96 }}>{PACKS[k].icon} {PACKS[k].name}<input type="time" id={`pack-${k}`} value={f[`pack_${k}`]} onChange={(e) => setF({ ...f, [`pack_${k}`]: e.target.value })} /></label>)}</div><small>孩子的清單會顯示「幾點前完成」。單一任務要不同時間，到「任務獎勵」點那個任務設定完成時間。</small></div>
      {num("pack_bonus", "一組例行全部完成的全勤獎", "點")}
      {num("proposal_bonus", "主動提案加成", "%")}
      {num("proposal_daily_limit", "每天最多提案", "次")}
      {num("deposit_bonus", "存入存錢罐立即獎勵", "%")}
      {toggle("interest_on", "存錢罐每週利息", "每週日晚上依存款發利息")}
      {!!f.interest_on && <>{num("interest_rate", "存錢罐每週利息", "%")}
      {num("interest_cap", "每週利息上限", "點")}</>}
      <div className="rule-group"><b>🔥 連續達成獎勵</b><small>每天的例行全部完成算 1 天，自動加點</small>
        {num("streak7_bonus", "連續 7 天（之後每 7 天）", "點")}
        {num("streak30_bonus", "連續 30 天（之後每 30 天）", "點")}</div>
      <div className="rule-group"><b>⚠️ 扣點</b><small>給家長的快選原因和每天上限，避免一時情緒扣太多</small>
        {num("deduct_daily_cap", "每個孩子每天最多扣", "點")}
        <label className="field">快選原因（用「、」隔開）<textarea id="rule-deduct_reasons" rows={2} value={f.deduct_reasons} onChange={(e) => setF({ ...f, deduct_reasons: e.target.value })} /></label></div>
      {toggle("report_on", "📊 每週報告", "每週日晚上 8 點推播給家長（有綁 LINE 也會傳到群組）")}
      <div className="row"><label className="field" style={{ flex: 1 }}>孩子安靜時段開始<input type="text" id="q-start" value={f.quiet_start} onChange={(e) => setF({ ...f, quiet_start: e.target.value })} /></label><label className="field" style={{ flex: 1 }}>結束<input type="text" id="q-end" value={f.quiet_end} onChange={(e) => setF({ ...f, quiet_end: e.target.value })} /></label></div>
      <button className="btn" onClick={async () => { const r = await ui.busy(rpc("save_settings", { p: { ...f, pack_bonus: Number(f.pack_bonus) || 0, interest_cap: Number(f.interest_cap) || 0, proposal_daily_limit: Number(f.proposal_daily_limit) || 0, streak7_bonus: Number(f.streak7_bonus) || 0, streak30_bonus: Number(f.streak30_bonus) || 0, deduct_daily_cap: Number(f.deduct_daily_cap) || 0, deduct_reasons: f.deduct_reasons.trim(), deposit_bonus: (Number(f.deposit_bonus) || 0) / 100, interest_rate: (Number(f.interest_rate) || 0) / 100, proposal_bonus: (Number(f.proposal_bonus) || 0) / 100 } })); if (r !== undefined) { ui.toast("規則已更新"); refresh(); } }}>儲存規則</button>
    </div></>;
}

function NewMemberSheet({ onDone }: { onDone: () => void }) {
  const ui = useUi(); const [f, setF] = useState({ display_name: "", role: "child" as Role, login_id: "", password: "", avatar: "👦" }); const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return <>
    <h3>新增家庭成員</h3><p>建立後把帳號密碼告訴對方，用它登入就好。第一個孩子加入時會自動建立預設任務和獎勵。</p>
    <RolePick value={f.role} onChange={(r) => set({ role: r })} roles={["child", "parent", "admin", "guest"]} />
    <label className="field">稱呼<input type="text" id="m-name" value={f.display_name} placeholder="例如：媽媽、小宇" onChange={(e) => set({ display_name: e.target.value })} /></label>
    <label className="field">登入帳號（小寫英文或數字）<input type="text" id="m-login" autoCapitalize="none" value={f.login_id} onChange={(e) => set({ login_id: e.target.value.toLowerCase() })} /></label>
    <label className="field">密碼（至少 6 個字）<input type="text" id="m-pw" autoCapitalize="none" value={f.password} onChange={(e) => set({ password: e.target.value })} /></label>
    <div className="emoji-grid">{AVATARS.map((a) => <button key={a} className={f.avatar === a ? "on" : ""} onClick={() => set({ avatar: a })}>{a}</button>)}</div>
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button>
      <button className="btn" disabled={busy || !f.display_name || !f.login_id || f.password.length < 6} onClick={async () => { setBusy(true); const r = await ui.busy(adminCall({ action: "create_member", ...f })); setBusy(false); if (r) { ui.toast(`已建立 ${f.display_name} 的帳號`); onDone(); } }}>{busy ? "建立中…" : "建立"}</button></div>
  </>;
}

function MemberSheet({ m }: { m: Member }) {
  const { refresh } = useStore(); const ui = useUi(); const [pw, setPw] = useState(""); const [sure, setSure] = useState(false);
  const [role, setRole] = useState<Role>(m.role);
  return <>
    <h3>{m.avatar} {m.display_name}</h3><p>{ROLE[m.role]} · 帳號 {m.login_id}</p>
    {m.role !== "child" && <div className="field">授權身份<RolePick value={role} onChange={setRole} roles={["admin", "parent", "guest"]} />
      <button className="btn" disabled={role === m.role} onClick={async () => { const r = await ui.busy(adminCall({ action: "set_role", member_id: m.id, role })); if (r) { ui.sheet(null); ui.toast(`已把${m.display_name}設為${ROLE[role]}`); refresh(); } }}>{role === m.role ? "目前身份" : `改成${ROLE[role]}`}</button></div>}
    <label className="field">設定新密碼<input type="text" id="m-newpw" autoCapitalize="none" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
    <button className="btn" disabled={pw.length < 6} onClick={async () => { const r = await ui.busy(adminCall({ action: "reset_password", member_id: m.id, password: pw })); if (r) { ui.sheet(null); ui.toast("密碼已更新"); } }}>更新密碼</button>
    {!sure ? <button className="btn line" onClick={() => setSure(true)}>移除這位成員</button> :
      <><div className="warn">移除後，{m.display_name}的帳號、點數紀錄和任務會一起刪除，無法復原。</div>
        <button className="btn bad" onClick={async () => { const r = await ui.busy(adminCall({ action: "remove_member", member_id: m.id })); if (r) { ui.sheet(null); ui.toast("已移除"); refresh(); } }}>確定移除</button></>}
  </>;
}

function ProfileSheet() {
  const { me, refresh } = useStore(); const ui = useUi(); const [name, setName] = useState(me?.display_name ?? ""); const [av, setAv] = useState(me?.avatar ?? "🙂");
  return <><h3>我的資料</h3>
    <label className="field">稱呼<input type="text" id="me-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
    <div className="emoji-grid">{AVATARS.map((a) => <button key={a} className={av === a ? "on" : ""} onClick={() => setAv(a)}>{a}</button>)}</div>
    <button className="btn" onClick={async () => { const r = await ui.busy(rpc("update_profile", { p_name: name, p_avatar: av })); if (r !== undefined) { ui.sheet(null); refresh(); } }}>儲存</button></>;
}

function ChangelogSheet() {
  return <>
    <h3>優化紀錄</h3>
    <div className="changelog">{CHANGELOG.map((c, i) => <div className={`cl ${i === 0 ? "now" : ""}`} key={c.v}>
      <div className="cl-head"><b>v{c.v}</b><small>{c.date}{i === 0 ? " · 目前版本" : ""}</small></div>
      <ul>{c.items.map((x) => <li key={x}>{x}</li>)}</ul></div>)}</div>
  </>;
}

// LINE 群組通知：官方帳號金鑰存在雲端保險箱，用綁定碼連到家庭群組
const LINE_HOOK = "https://kiltwgraweoxxlaipwha.supabase.co/functions/v1/line-webhook";
interface LineSt { has_keys: boolean; bound: boolean; bound_at: string | null; code: string | null; code_exp: string | null }
function LineSetup() {
  const { family, refresh } = useStore(); const ui = useUi();
  const [st, setSt] = useState<LineSt | null>(null); const [err, setErr] = useState(false);
  const [tok, setTok] = useState(""); const [sec, setSec] = useState(""); const [editKeys, setEditKeys] = useState(false);
  const load = () => rpc<LineSt>("line_status").then((x) => { setSt(x); setErr(false); }).catch(() => setErr(true));
  useEffect(() => { load(); }, []);
  const on = Number(family?.settings.line_on ?? 1) !== 0;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); ui.toast("已複製"); } catch { ui.toast(t); } };
  return <><h2 className="sec">LINE 群組通知<small>只有管理員</small></h2>
    <div className="card line-card">
      {err ? <div className="warn">LINE 設定暫時讀不到，請稍後再試。</div> : !st ? <div className="spinner" /> : <>
        <div className="steps">
          <div className={`step ${st.has_keys ? "done" : ""}`}><span className="dot">1</span><div>填入 LINE 官方帳號的金鑰<small>LINE Developers → 你的 Messaging API channel</small></div></div>
          <div className={`step ${st.bound ? "done" : ""}`}><span className="dot">2</span><div>把官方帳號加進家庭群組，輸入綁定碼</div></div>
        </div>
        {(!st.has_keys || editKeys) ? <>
          <label className="field">Channel access token（長期）<input type="password" id="line-token" autoComplete="off" value={tok} onChange={(e) => setTok(e.target.value)} /></label>
          <label className="field">Channel secret<input type="password" id="line-secret" autoComplete="off" value={sec} onChange={(e) => setSec(e.target.value)} /></label>
          <div className="field">Webhook URL（貼到 LINE Developers 的 Messaging API 設定）<div className="date-add"><input type="text" readOnly value={LINE_HOOK} id="line-hook" /><button type="button" className="btn sm line" onClick={() => copy(LINE_HOOK)}>複製</button></div></div>
          <div className="row">{st.has_keys && <button className="btn line" onClick={() => setEditKeys(false)}>取消</button>}
            <button className="btn" disabled={tok.trim().length < 20 || sec.trim().length < 10} onClick={async () => { const r = await ui.busy(rpc("line_save_keys", { p_token: tok, p_secret: sec })); if (r !== undefined) { setTok(""); setSec(""); setEditKeys(false); ui.toast("金鑰已安全儲存"); load(); } }}>儲存金鑰</button></div>
          <small className="hint">金鑰存在雲端保險箱，App 和孩子都看不到。</small>
        </> : !st.bound ? <>
          {st.code ? <div className="bind-code"><small>在家庭 LINE 群組輸入</small><b>綁定 {st.code}</b><small>30 分鐘內有效</small><button className="btn sm line" onClick={() => copy(`綁定 ${st.code}`)}>複製</button></div>
            : <p className="hint">先把官方帳號加進家庭群組，再按下面產生綁定碼。</p>}
          <div className="row"><button className="btn" onClick={async () => { const r = await ui.busy(rpc<string>("line_new_code")); if (r !== undefined) load(); }}>{st.code ? "重新產生綁定碼" : "產生綁定碼"}</button><button className="btn line" onClick={load}>我輸入了，重新整理</button></div>
          <button className="link" onClick={() => setEditKeys(true)}>重新填寫金鑰</button>
        </> : <>
          <div className="set-row"><div>✅ 已連結家庭群組<small>{st.bound_at ? new Date(st.bound_at).toLocaleDateString("zh-TW") + " 綁定" : ""}</small></div>
            <button type="button" role="switch" id="line-on" aria-checked={on} className={`switch ${on ? "on" : ""}`} onClick={async () => { const r = await ui.busy(rpc("save_settings", { p: { line_on: on ? 0 : 1 } })); if (r !== undefined) { refresh(); ui.toast(on ? "已暫停 LINE 通知" : "LINE 通知已開啟"); } }} /></div>
          <small className="hint">會傳到群組的事：兌換申請、孩子完成交辦、扣點、連續達成、每週報告。</small>
          <div className="row"><button className="btn line" onClick={async () => { const r = await ui.busy(rpc("line_test")); if (r !== undefined) ui.toast("已送出測試訊息，看看群組"); }}>傳送測試</button>
            <button className="btn line" onClick={async () => { const r = await ui.busy(rpc("line_unbind")); if (r !== undefined) { ui.toast("已解除綁定"); load(); } }}>解除綁定</button></div>
        </>}
      </>}
    </div></>;
}
