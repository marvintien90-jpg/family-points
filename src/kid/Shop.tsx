import { useStore } from "../store";
import { useUi } from "../ui/ui";
import { Reward, TIER, rpc, when } from "../supabase";
import type { KidData } from "./KidApp";

export function Shop({ data, goJar }: { data: KidData; goJar: () => void }) {
  const { me, reloadMe } = useStore(); const ui = useUi(); const w = data.wallet;
  const source = (r: Reward) => (r.tier === "large" ? "jar" : r.tier === "medium" && (w?.spend ?? 0) < r.cost ? "jar" : "spend");
  const have = (r: Reward) => (source(r) === "jar" ? w?.jar_value ?? 0 : w?.spend ?? 0);

  function open(r: Reward) {
    const src = source(r), h = have(r);
    if (h < r.cost) {
      ui.dialog(<><h3>{r.emoji} {r.title}</h3><p>還差 <b style={{ color: "var(--gold)" }}>{r.cost - h}</b> 點。{src === "jar" ? "這個要用存錢罐換，存越久倍率越高。" : "多完成幾個任務就到了！"}</p>
        <div className="row">{src === "jar" && <button className="btn ghost" onClick={() => { ui.dialog(null); goJar(); }}>去存錢罐</button>}
          <button className="btn line" onClick={async () => { await ui.busy(rpc("set_dream", { p_reward: r.id })); await reloadMe(); ui.dialog(null); ui.toast("設成夢想目標了"); }}>設成夢想目標</button></div></>);
      return;
    }
    ui.dialog(<><h3>兌換 {r.emoji} {r.title}？</h3>
      <p>從{src === "jar" ? "存錢罐" : "零用包"}扣 <b style={{ color: "var(--gold)" }}>{r.cost}</b> 點。爸媽同意前點數先保留，不同意會全部退回。</p>
      {src === "jar" && <div className="warn">存錢罐目前價值 {w?.jar_value} 點（含倍率），兌換後剩 {(w?.jar_value ?? 0) - r.cost}。</div>}
      <div className="row"><button className="btn line" onClick={() => ui.dialog(null)}>再想想</button>
        <button className="btn" onClick={async () => { const x = await ui.busy(rpc("request_redemption", { p_reward: r.id })); ui.dialog(null); if (x !== undefined) { ui.toast("已申請兌換，等爸媽同意"); data.reload(); } }}>確定兌換</button></div></>);
  }

  const pending = data.redemptions.filter((x) => x.status === "pending");
  return <>
    {pending.length > 0 && <><h2 className="sec">等待爸媽同意</h2><div className="card">{pending.map((x) => <div className="lot" key={x.id}><span>{x.emoji} {x.title}</span><span className="tag gold">⏳ {x.cost} 點</span></div>)}</div></>}
    {(["small", "medium", "large"] as const).map((tier) => {
      const list = data.rewards.filter((r) => r.tier === tier); if (!list.length) return null;
      return <div key={tier} style={{ display: "contents" }}>
        <h2 className="sec">{TIER[tier].name}<small>{TIER[tier].hint}</small></h2>
        <div className="card">{list.map((r) => <div className="rew" key={r.id}><span className="emo">{r.emoji}</span>
          <div className="mid"><b>{r.title}{me?.dream_reward_id === r.id ? " ⭐" : ""}</b><small>{have(r) >= r.cost ? "可以兌換" : `還差 ${r.cost - have(r)} 點`}</small></div>
          <button className={`btn sm ${have(r) >= r.cost ? "" : "line"}`} onClick={() => open(r)}><span className="cost" style={{ color: "inherit" }}>{r.cost}</span></button></div>)}</div>
      </div>;
    })}
    {data.redemptions.some((x) => x.status !== "pending") && <><h2 className="sec">兌換紀錄</h2><div className="card ledger">{data.redemptions.filter((x) => x.status !== "pending").map((x) => <div className="l" key={x.id}><div>{x.emoji} {x.title}<small>{when(x.created_at)}{x.reject_reason ? ` · ${x.reject_reason}` : ""}</small></div><span className={x.status === "approved" ? "plus" : "minus"}>{x.status === "approved" ? "已兌換" : "已退回"}</span></div>)}</div></>}
  </>;
}
