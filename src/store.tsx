import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Family, Member, sb } from "./supabase";

interface Store { session: Session | null; me: Member | null; family: Family | null; members: Member[]; tick: number; refresh: () => void; loading: boolean; reloadMe: () => Promise<void> }
const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Member | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setMe(null); setLoading(false); } });
    return () => data.subscription.unsubscribe();
  }, []);

  const reloadMe = useCallback(async () => {
    if (!session) return;
    const { data: m } = await sb.from("members").select("*").eq("id", session.user.id).maybeSingle();
    setMe(m as Member | null);
    if (m) {
      const [{ data: f }, { data: ms }] = await Promise.all([
        sb.from("families").select("*").eq("id", m.family_id).single(),
        sb.from("members").select("*").eq("family_id", m.family_id).order("created_at"),
      ]);
      setFamily(f as Family); setMembers((ms ?? []) as Member[]);
    }
    setLoading(false);
  }, [session]);
  useEffect(() => { reloadMe(); }, [reloadMe, tick]);

  // 即時更新：任何任務、兌換、通知變動就重新整理
  useEffect(() => {
    if (!me) return;
    const ch = sb.channel("fp-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `family_id=eq.${me.family_id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "redemptions", filter: `family_id=eq.${me.family_id}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `member_id=eq.${me.id}` }, refresh)
      .subscribe();
    const vis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", vis);
    return () => { sb.removeChannel(ch); document.removeEventListener("visibilitychange", vis); };
  }, [me?.id, me?.family_id, refresh]);

  return <Ctx.Provider value={{ session, me, family, members, tick, refresh, loading, reloadMe }}>{children}</Ctx.Provider>;
}
