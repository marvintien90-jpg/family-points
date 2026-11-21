import { useStore } from "../store";
import { RollNumber, flyCoins, useUi } from "../ui/ui";
import { jarMult, jarTier, rpc } from "../supabase";
import type { KidData } from "./KidApp";

function JarArt({ days, fill }: { days: number; fill: number }) {
  const col = days >= 60 ? "var(--diamond)" : days >= 30 ? "var(--gold)" : days >= 14 ? "var(--silver)" : "var(--kid)"; const h = 120 * Math.min(1, fill);
  return <svg viewBox="0 0 150 170" aria-hidden="true"><rect x="45" y="6" width="60" height="16" rx="5" fill={col} />
    <path d="M38 26h74c8 0 14 6 14 14v110c0 8-6 14-14 14H38c-8 0-14-6-14-14V40c0-8 6-14 14-14z" fill="var(--surface-2)" stroke={col} strokeWidth="4" />
    <rect x="28" y={160 - h} width="94" height={h} rx="10" fill={col} opacity=".35" style={{ transition: "all .8s" }} /><text x="75" y="105" textAnchor="middle" fontSize="34">🪙</text></svg>;
}

export function Jar({ data }: { data: KidData }) {
  const { me, family } = useStore(); const ui = useUi(); const w = data.wallet;
  const dream = data.rewards.find((r) => r.id === me?.dream_reward_id) ?? data.rewards.filter((r) => r.tier === "large")[0];
  const pct = dream && w ? Math.min(100, Math.round((w.jar_value / dream.cost) * 100)) : 0;
  const bonusPct = Math.round(Number(family?.settings.deposit_bonus ?? 0.05) * 100);

  async function deposit(amt: number, el: Element) {
    if (!w || amt <= 0 || amt > w.spend) { ui.toast("零用包的點數不夠"); return; }
    const bonus = await ui.busy(rpc<number>("deposit_jar", { p_amount: amt }));
    if (bonus === undefined) return; flyCoins(el, "jar-art"); ui.toast(`存入 ${amt}，多拿 ${bonus} 點`); setTimeout(data.reload, 700);
  }
  function withdraw() {
    if (!w) return; const loss = w.jar_value - w.jar_raw;
    ui.dialog(<><h3>確定提前領出？</h3><p>存錢罐 {w.jar_raw} 點會移到零用包。</p>
      {loss > 0 && <div className="warn">現在領出會失去倍率加成 <b>{loss}</b> 點，存放天數也會歸零。</div>}
      <div className="row"><button className="btn line" onClick={() => ui.dialog(null)}>繼續存著</button>
        <button className="btn bad" onClick={async () => { const r = await ui.busy(rpc<number>("withdraw_jar")); ui.dialog(null); if (r !== undefined) { ui.toast(`已領出 ${r} 點`); data.reload(); } }}>還是要領</button></div></>);
  }

  return <>
    <div className="card jar-wrap"><div className="jar" id="jar-art"><JarArt days={w?.best_days ?? 0} fill={pct / 100} /></div>
      <span className="jar-tier"><RollNumber value={w?.jar_value ?? 0} /> 點</span>
      <span className="tag acc">{jarTier(w?.best_days ?? 0)} · 最高倍率 ×{jarMult(w?.best_days ?? 0)}</span>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>零用包還有 {w?.spend ?? 0} 點</span>
      <div className="row"><button className="btn" onClick={(e) => deposit(50, e.currentTarget)}>存 50</button><button className="btn" onClick={(e) => deposit(100, e.currentTarget)}>存 100</button><button className="btn ghost" onClick={(e) => deposit(w?.spend ?? 0, e.currentTarget)}>全部存入</button></div>
      <small style={{ color: "var(--muted)", fontSize: 12, textAlign: "center" }}>存入立刻多 {bonusPct}%，每週日晚上再加利息</small></div>
    {dream && <><h2 className="sec">夢想目標<small>{w && w.jar_value < dream.cost ? `還差 ${dream.cost - w.jar_value} 點` : "可以兌換了！"}</small></h2>
      <div className="card"><div className="rew"><span className="emo">{dream.emoji}</span><div className="mid"><b>{dream.title}</b><small>{w?.jar_value ?? 0} / {dream.cost} 點 · 到商店可以換目標</small></div><b className="cost">{pct}%</b></div><div className="goal-bar"><i style={{ width: `${pct}%` }} /></div></div></>}
    <h2 className="sec">存越久越大<small>14 天 ×1.1 · 30 天 ×1.25 · 60 天 ×1.5</small></h2>
    <div className="card">{(w?.lots ?? []).length === 0 ? <div className="empty">還沒有存款，先存一點試試看</div> :
      w!.lots.map((l) => <div className="lot" key={l.id}><span>{l.days} 天前存入 <span className={`tag ${l.days >= 14 ? "gold" : ""}`}>{jarTier(l.days)} ×{jarMult(l.days)}</span></span><span className="n">{l.amount} → {Math.round(l.amount * jarMult(l.days))}</span></div>)}
      {(w?.jar_raw ?? 0) > 0 && <button className="btn line sm" onClick={withdraw}>提前領出到零用包</button>}</div>
  </>;
}
