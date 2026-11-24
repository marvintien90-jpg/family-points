import { useUi } from "./ui";

export const RATINGS = ["🌟 超棒", "👍 很好", "🙂 還可以", "💪 再加油"];
// 核准時的評價快選：點一下就核准並送出評價
export function RateSheet({ title, sub, onPick }: { title: string; sub?: string; onPick: (rating: string | null) => void }) {
  const ui = useUi();
  return <>
    <h3>核准：{title}</h3><p>{sub ?? "選一個評價，孩子會收到。"}</p>
    <div className="rate-grid">{RATINGS.map((r) => <button key={r} className="rate-opt" onClick={() => onPick(r)}><span>{r.split(" ")[0]}</span>{r.split(" ")[1]}</button>)}</div>
    <div className="row"><button className="btn line" onClick={() => ui.sheet(null)}>取消</button><button className="btn good" onClick={() => onPick(null)}>直接核准，不評價</button></div>
  </>;
}
