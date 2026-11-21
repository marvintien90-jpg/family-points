import { useStore } from "../store";
import { useUi } from "../ui/ui";
import { sb, when } from "../supabase";
import { enablePush, pushPermission } from "../push";
import type { KidData } from "./KidApp";

export function Me({ data }: { data: KidData }) {
  const { me } = useStore(); const ui = useUi(); const w = data.wallet;
  const approved = data.ledger.filter((l) => l.amount > 0).length;
  const badges: [string, string, boolean][] = [
    ["🌱", "第一次賺點", approved > 0], ["💰", "第一次存錢", (w?.jar_raw ?? 0) > 0 || data.ledger.some((l) => l.reason.startsWith("存入"))],
    ["🥈", "銀罐", (w?.best_days ?? 0) >= 14], ["🥇", "金罐", (w?.best_days ?? 0) >= 30], ["💎", "鑽石罐", (w?.best_days ?? 0) >= 60],
    ["🏅", "Lv 5", (w?.level ?? 1) >= 5], ["🏆", "Lv 10", (w?.level ?? 1) >= 10], ["🎁", "第一次兌換", data.redemptions.some((r) => r.status === "approved")],
  ];
  const perm = pushPermission();
  return <>
    {perm !== "granted" && <div className="card"><b>打開通知</b><p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>爸媽核准、給你點數的時候，手機會馬上告訴你。</p>
      <button className="btn" onClick={async () => { const r = await ui.busy(enablePush(me!.id).then(() => true)); if (r) ui.toast("通知打開了"); }}>開啟通知</button></div>}
    <h2 className="sec">徽章<small>{badges.filter((b) => b[2]).length} / {badges.length}</small></h2>
    <div className="card"><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>{badges.map(([e, n, on]) => <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--muted)", textAlign: "center" }}>
      <i style={{ fontStyle: "normal", fontSize: 26, width: 52, height: 52, borderRadius: "50%", display: "grid", placeItems: "center", background: on ? "var(--gold-soft)" : "var(--surface-2)", filter: on ? "none" : "grayscale(1)", opacity: on ? 1 : 0.4 }}>{e}</i>{n}</div>)}</div></div>
    <h2 className="sec">點數紀錄<small>每一筆都查得到</small></h2>
    <div className="card ledger">{data.ledger.length === 0 ? <div className="empty">還沒有紀錄</div> : data.ledger.map((l) => <div className="l" key={l.id}><div>{l.reason}<small>{l.account === "jar" ? "存錢罐" : "零用包"} · {when(l.created_at)}</small></div><span className={l.amount >= 0 ? "plus" : "minus"}>{l.amount >= 0 ? "+" : ""}{l.amount}</span></div>)}</div>
    <h2 className="sec">最近的通知</h2>
    <div className="card ledger">{data.notices.length === 0 ? <div className="empty">沒有通知</div> : data.notices.map((n) => <div className="l" key={n.id}><div>{n.title}<small>{n.body} · {when(n.created_at)}</small></div></div>)}</div>
    <button className="btn line" onClick={() => sb.auth.signOut()}>登出</button>
  </>;
}
