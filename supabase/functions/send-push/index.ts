// 家庭點點樂：把 notifications 送成 iPhone／瀏覽器推播
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// 金鑰放在資料庫 Vault，由 fp_push_config() 讀出
let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await db.rpc("fp_push_config");
  if (error) throw error;
  cfg = data as Record<string, string>;
  webpush.setVapidDetails(cfg.fp_vapid_subject ?? "mailto:family@example.com", cfg.fp_vapid_public, cfg.fp_vapid_private);
  return cfg;
}

function taipeiMinutes() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(p.find((x) => x.type === "hour")!.value) % 24 * 60 + Number(p.find((x) => x.type === "minute")!.value);
}
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
function inQuiet(settings: Record<string, unknown>) {
  const s = toMin(String(settings.quiet_start ?? "21:30")), e = toMin(String(settings.quiet_end ?? "07:00")), n = taipeiMinutes();
  return s > e ? (n >= s || n < e) : (n >= s && n < e);
}

async function deliver(memberId: string, title: string, body: string, url: string) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("member_id", memberId);
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("member_id", memberId).is("read_at", null);
  const payload = JSON.stringify({ title, body, url, badge: count ?? 0 });
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push failed", code, String(err));
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  const c = await config();
  if (!c.fp_push_secret || req.headers.get("x-push-secret") !== c.fp_push_secret) return new Response("forbidden", { status: 403 });
  const input = await req.json().catch(() => ({}));
  let q = db.from("notifications").select("id, member_id, title, body, url, members!inner(role, families!inner(settings))").is("sent_at", null);
  if (input.id) q = q.eq("id", input.id);
  else q = q.gte("created_at", new Date(Date.now() - 24 * 3600e3).toISOString());
  const { data: rows, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  // 依成員分組；孩子在安靜時段先不送，早上合併成一則
  const groups = new Map<string, typeof rows>();
  for (const r of rows ?? []) {
    // deno-lint-ignore no-explicit-any
    const m = (r as any).members;
    if (m.role === "child" && inQuiet(m.families.settings ?? {})) continue;
    groups.set(r.member_id, [...(groups.get(r.member_id) ?? []), r]);
  }
  let sent = 0;
  for (const [member, list] of groups) {
    const one = list.length === 1;
    sent += await deliver(member, one ? list[0].title : `你有 ${list.length} 則新消息`, one ? list[0].body : list.map((x) => x.title).join("、"), one ? list[0].url : "/");
    await db.from("notifications").update({ sent_at: new Date().toISOString() }).in("id", list.map((x) => x.id));
  }
  return Response.json({ sent });
});
