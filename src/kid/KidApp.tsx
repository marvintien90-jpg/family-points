import { useCallback, useEffect, useRef, useState } from "react";
import { PullScreen } from "../ui/Pull";
import { useStore } from "../store";
import { useDailyBrief } from "../Brief";
import { useUi, RollNumber, floatPoints, useTab } from "../ui/ui";
import { Ledger, Notice, Redemption, Reward, Streak, Task, Wallet, jarTier, rpc, sb, todayTW } from "../supabase";
import { Today } from "./Today";
import { Shop } from "./Shop";
import { Jar } from "./Jar";
import { Me } from "./Me";
import { History } from "../History";

export interface KidData { wallet: Wallet | null; tasks: Task[]; rewards: Reward[]; redemptions: Redemption[]; ledger: Ledger[]; notices: Notice[]; streak: Streak | null; reload: () => Promise<void> }

const TABS = [["today", "📋", "今天"], ["shop", "🎁", "商店"], ["jar", "🫙", "存錢罐"], ["history", "📖", "回顧"], ["me", "⭐", "我"]] as const;
type Tab = (typeof TABS)[number][0];

export function KidApp() {
  const { me, tick } = useStore(); const ui = useUi();
  const [tab, setTab] = useTab<Tab>(TABS.map((t) => t[0]), "today");
  useDailyBrief((t) => setTab(t as Tab));
  const [d, setD] = useState<Omit<KidData, "reload">>({ wallet: null, tasks: [], rewards: [], redemptions: [], ledger: [], notices: [], streak: null });
  const prev = useRef<{ spend: number; level: number; notice: number } | null>(null);

  const reload = useCallback(async () => {
    if (!me) return;
    await rpc("ensure_today").catch(() => {});
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [wallet, tasks, rewards, reds, ledger, notices, streak] = await Promise.all([
      rpc<Wallet>("get_wallet"),
      sb.from("tasks").select("*").eq("assignee", me.id).neq("status", "void").or(`for_date.eq.${todayTW()},and(kind.neq.routine,created_at.gte.${since})`).order("created_at"),
      sb.from("rewards").select("*").eq("active", true).order("cost"),
      sb.from("redemptions").select("*").eq("member_id", me.id).order("created_at", { ascending: false }).limit(20),
      sb.from("ledger").select("*").eq("member_id", me.id).order("created_at", { ascending: false }).limit(40),
      sb.from("notifications").select("*").eq("member_id", me.id).order("created_at", { ascending: false }).limit(20),
      rpc<Streak>("get_streak").catch(() => null),
    ]);
    setD({ wallet, tasks: (tasks.data ?? []) as Task[], rewards: (rewards.data ?? []) as Reward[], redemptions: (reds.data ?? []) as Redemption[], ledger: (ledger.data ?? []) as Ledger[], notices: (notices.data ?? []) as Notice[], streak });
  }, [me]);
  useEffect(() => { reload(); }, [reload, tick]);

  // 點數變多、升級、新通知時的回饋
  useEffect(() => {
    const w = d.wallet; if (!w) return;
    const top = d.notices[0]?.id ?? 0, p = prev.current;
    if (p) {
      if (top > p.notice && d.notices[0]) ui.banner(d.notices[0].title, d.notices[0].body);
      if (w.spend > p.spend && top > p.notice) floatPoints(`+${w.spend - p.spend}`, document.getElementById("spend-n"));
    }
    let seen = 0; try { seen = Number(localStorage.getItem("fp-level") || 0); } catch { /* */ }
    if (seen && w.level > seen) ui.celebrate("🏅", `升到 Lv ${w.level}！`, "累積的努力被看見了，繼續加油。");
    try { localStorage.setItem("fp-level", String(w.level)); } catch { /* */ }
    prev.current = { spend: w.spend, level: w.level, notice: top };
  }, [d.wallet, d.notices]); // eslint-disable-line

  const data: KidData = { ...d, reload };
  return <div className="app mode-kid">
    <PullScreen>
      {tab !== "jar" && tab !== "history" && <Hero data={data} />}
      {tab === "today" && <Today data={data} />}
      {tab === "shop" && <Shop data={data} goJar={() => setTab("jar")} />}
      {tab === "jar" && <Jar data={data} />}
      {tab === "history" && <History />}
      {tab === "me" && <Me data={data} />}
    </PullScreen>
    <nav className="tabs">{TABS.map(([k, i, l]) => <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><span className="ic">{i}</span>{l}</button>)}</nav>
  </div>;
}

function Hero({ data }: { data: KidData }) {
  const { me } = useStore(); const w = data.wallet;
  const into = w ? w.lifetime % w.level_points : 0;
  return <div className="hero">
    <div className="hero-row"><div className="who"><div className="avatar">{me?.avatar}</div><div><b>{me?.display_name}</b><small>今天也一起加油</small></div></div><span className="lv">Lv {w?.level ?? 1}</span></div>
    <div className="wallets">
      <div className="wallet"><span>零用包</span><RollNumber value={w?.spend ?? 0} id="spend-n" /></div>
      <div className="wallet"><span>存錢罐 · {jarTier(w?.best_days ?? 0)}</span><RollNumber value={w?.jar_value ?? 0} id="jar-n" /></div>
    </div>
    <div><div className="xp-label"><span>距離 Lv {(w?.level ?? 1) + 1}</span><span>{into} / {w?.level_points ?? 300}</span></div><div className="xpbar"><i style={{ width: `${w ? (into / w.level_points) * 100 : 0}%` }} /></div></div>
  </div>;
}
