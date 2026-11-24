import { useState } from "react";
import { WEEK, todayTW } from "../supabase";

export interface Sched { days: number[]; dates: string[]; at_time: string }
const prettyDate = (d: string) => new Date(d + "T12:00:00+08:00").toLocaleDateString("zh-TW", { year: d.slice(0, 4) === todayTW().slice(0, 4) ? undefined : "numeric", month: "numeric", day: "numeric", weekday: "short" });
const addDays = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + n * 864e5));

// 排程：每週固定哪幾天，或指定某年某月某日；可加時間點（到時間前會提醒）
export function SchedulePick({ value, onChange, idp = "s" }: { value: Sched; onChange: (v: Sched) => void; idp?: string }) {
  const [mode, setMode] = useState<"week" | "dates">(value.dates.length ? "dates" : "week");
  const [pick, setPick] = useState(addDays(1));
  const set = (p: Partial<Sched>) => onChange({ ...value, ...p });
  const addDate = (d: string) => { if (d && !value.dates.includes(d)) set({ dates: [...value.dates, d].sort() }); };
  const switchMode = (m: "week" | "dates") => { setMode(m); onChange(m === "week" ? { ...value, dates: [], days: value.days.length ? value.days : [0, 1, 2, 3, 4, 5, 6] } : { ...value, dates: value.dates.length ? value.dates : [pick] }); };
  return <>
    <div className="field">什麼時候做
      <div className="seg"><button type="button" className={mode === "week" ? "on" : ""} onClick={() => switchMode("week")}>每週固定</button><button type="button" className={mode === "dates" ? "on" : ""} onClick={() => switchMode("dates")}>指定日期</button></div>
    </div>
    {mode === "week" ? <div className="field">哪幾天<div className="days">{WEEK.map((d, i) => <button type="button" key={i} className={value.days.includes(i) ? "on" : ""} onClick={() => set({ days: value.days.includes(i) ? value.days.filter((x) => x !== i) : [...value.days, i].sort() })}>{d}</button>)}</div>
      <div className="row"><button type="button" className="chip" onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>每天</button><button type="button" className="chip" onClick={() => set({ days: [1, 2, 3, 4, 5] })}>上學日</button><button type="button" className="chip" onClick={() => set({ days: [0, 6] })}>週末</button></div></div>
      : <div className="field">日期（可以加好幾天，例如考試日、生日）
        <div className="date-add"><input type="date" id={`${idp}-date`} value={pick} min={todayTW()} onChange={(e) => setPick(e.target.value)} /><button type="button" className="btn sm" onClick={() => addDate(pick)}>加入</button></div>
        <div className="row">{value.dates.length === 0 ? <small className="hint">還沒加日期</small> : value.dates.map((d) => <button type="button" key={d} className="chip on" onClick={() => set({ dates: value.dates.filter((x) => x !== d) })} aria-label={`移除 ${d}`}>{prettyDate(d)} ✕</button>)}</div></div>}
    <div className="field">完成時間（選填，幾點前要做完；前 15 分鐘提醒）
      <div className="date-add"><input type="time" id={`${idp}-time`} value={value.at_time} onChange={(e) => set({ at_time: e.target.value })} />{value.at_time && <button type="button" className="btn sm line" onClick={() => set({ at_time: "" })}>不設時間</button>}</div>
      <div className="row">{["07:00", "12:00", "17:30", "20:00", "21:00"].map((t) => <button type="button" key={t} className={`chip ${value.at_time === t ? "on" : ""}`} onClick={() => set({ at_time: t })}>{t}</button>)}</div>
    </div>
  </>;
}

// 交辦截止：日期 + 時間分開選，常用的一鍵帶入
export function DuePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [d, t] = value ? value.split("T") : ["", ""];
  const sat = (() => { const dow = new Date(todayTW() + "T12:00:00+08:00").getUTCDay(); return addDays(((6 - dow + 7) % 7) || 7); })();
  const quick: [string, string, string][] = [["今天", addDays(0), "20:00"], ["明天", addDays(1), "20:00"], ["週六", sat, "12:00"], ["下週", addDays(7), "20:00"]];
  return <div className="field">截止時間（前一小時提醒）
    <div className="row">{quick.map(([l, qd, qt]) => <button type="button" key={l} className={`chip ${d === qd ? "on" : ""}`} onClick={() => onChange(`${qd}T${t || qt}`)}>{l}</button>)}<button type="button" className={`chip ${!value ? "on" : ""}`} onClick={() => onChange("")}>不設截止</button></div>
    {value && <div className="date-add two"><input type="date" id="e-date" value={d} onChange={(e) => onChange(e.target.value ? `${e.target.value}T${t || "20:00"}` : "")} /><input type="time" id="e-time" value={t} onChange={(e) => onChange(`${d}T${e.target.value || "20:00"}`)} /></div>}
  </div>;
}
// 台灣時間字串轉 ISO
export const twToIso = (v: string) => (v ? new Date(`${v}:00+08:00`).toISOString() : null);
export const twDefault = (days: number, time: string) => `${addDays(days)}T${time}`;
