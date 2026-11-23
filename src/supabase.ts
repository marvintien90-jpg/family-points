import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

export type Role = "admin" | "parent" | "child" | "guest";
export interface Member { id: string; family_id: string; display_name: string; role: Role; avatar: string; login_id: string; dream_reward_id: string | null }
export interface Family { id: string; name: string; settings: Record<string, number | string> }
export interface Task {
  id: string; kind: "routine" | "proposal" | "errand"; title: string; emoji: string; points: number; pack: "am" | "pm" | "bed" | null;
  photo: "none" | "optional" | "required"; assignee: string; created_by: string | null; for_date: string | null; due_at: string | null;
  status: "todo" | "submitted" | "approved" | "rejected" | "void"; photo_path: string | null; reject_reason: string | null;
  submitted_at: string | null; decided_at: string | null; created_at: string; template_id: string | null; ack_at?: string | null; plan?: Plan | null;
}
export interface Plan { days?: number[]; dates?: string[]; at_time?: string | null; pack?: string | null }
export interface Template { id: string; assignee: string; title: string; emoji: string; points: number; pack: "am" | "pm" | "bed" | null; days: number[]; dates?: string[]; at_time?: string | null; photo: "none" | "optional" | "required"; active: boolean; sort: number }
export interface Reward { id: string; title: string; emoji: string; cost: number; tier: "small" | "medium" | "large"; active: boolean }
export interface Redemption { id: string; member_id: string; title: string; emoji: string; cost: number; source: "spend" | "jar"; status: "pending" | "approved" | "rejected"; reject_reason: string | null; created_at: string }
export interface Ledger { id: number; member_id: string; account: "spend" | "jar"; amount: number; reason: string; created_at: string; created_by: string | null; ref_type?: string | null; ref_id?: string | null; ref_ledger?: number | null }
export interface Wallet { member_id: string; spend: number; jar_raw: number; jar_value: number; best_days: number; lifetime: number; level: number; level_points: number; lots: { id: string; amount: number; days: number }[] }
export interface Notice { id: number; title: string; body: string; url: string; created_at: string; read_at: string | null }

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function adminCall(body: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke("admin", { body });
  if (error) {
    // deno-lint-ignore no-explicit-any
    const ctx = (error as any).context;
    let msg = error.message;
    try { msg = (await ctx.json()).error ?? msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data;
}

export const PACKS: Record<string, { name: string; time: string; icon: string }> = {
  am: { name: "早上", time: "07:30 前", icon: "🌅" }, pm: { name: "放學後", time: "18:00 前", icon: "🎒" }, bed: { name: "睡前", time: "21:00 前", icon: "🌙" },
};
export const TIER: Record<string, { name: string; hint: string }> = {
  small: { name: "小獎", hint: "用零用包" }, medium: { name: "中獎", hint: "零用包或存錢罐" }, large: { name: "大獎", hint: "只能用存錢罐，有倍率加成" },
};
export const jarMult = (d: number) => (d >= 60 ? 1.5 : d >= 30 ? 1.25 : d >= 14 ? 1.1 : 1);
export const jarTier = (d: number) => (d >= 60 ? "鑽石罐" : d >= 30 ? "金罐" : d >= 14 ? "銀罐" : "普通罐");
export const todayTW = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
export function when(iso: string) {
  const d = new Date(iso), diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return "剛剛"; if (diff < 60) return `${Math.floor(diff)} 分鐘前`; if (diff < 60 * 24) return `${Math.floor(diff / 60)} 小時前`;
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// 截止時間的口語說法：「今天 18:00」「明天 08:00」「已過期」
export function dueText(iso: string) {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(x);
  const hm = d.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.getTime() < now.getTime()) return "已過期";
  if (day(d) === day(now)) return `今天 ${hm}`;
  if (day(d) === day(new Date(now.getTime() + 864e5))) return `明天 ${hm}`;
  return d.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }) + ` ${hm}`;
}

// 排程的口語說法：「每天 07:30」「一三五」「12/25、1/1」
export const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export const hm = (t?: string | null) => (t ? t.slice(0, 5) : "");
export function scheduleText(p: { days?: number[]; dates?: string[]; at_time?: string | null }) {
  const ds = p.dates ?? [];
  const when = ds.length ? ds.slice().sort().map((d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`).join("、") : (p.days ?? []).length === 7 ? "每天" : (p.days ?? []).length === 0 ? "未設定" : "每週" + (p.days ?? []).map((d) => WEEK[d]).join("");
  return when + (p.at_time ? ` ${hm(p.at_time)}` : "");
}
export const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
