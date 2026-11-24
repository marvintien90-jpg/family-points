// 家庭點點樂：LINE 官方帳號 webhook。群組裡輸入「綁定 123456」就把群組連到家庭
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function config(): Promise<{ token: string | null; secret: string | null }> {
  const { data, error } = await db.rpc("fp_line_config");
  if (error) throw error;
  return data as { token: string | null; secret: string | null };
}

async function validSignature(secret: string, body: string, sig: string | null) {
  if (!sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const b64 = btoa(String.fromCharCode(...mac));
  if (b64.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < b64.length; i++) diff |= b64.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function reply(token: string, replyToken: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const body = await req.text();
  let cfg;
  try { cfg = await config(); } catch (e) { console.error("config", String(e)); return new Response("config", { status: 500 }); }
  if (!cfg.secret || !cfg.token) return new Response("not configured", { status: 200 });
  if (!(await validSignature(cfg.secret, body, req.headers.get("x-line-signature")))) return new Response("bad signature", { status: 401 });
  const events = (JSON.parse(body).events ?? []) as Array<Record<string, any>>; // deno-lint-ignore no-explicit-any
  for (const ev of events) {
    const src = ev.source ?? {}; const gid: string | undefined = src.groupId ?? src.roomId;
    if (ev.type === "join" && ev.replyToken) {
      await reply(cfg.token, ev.replyToken, "大家好，我是家庭點點樂小幫手 👋\n請管理員在 App「設定 → LINE 群組通知」按「產生綁定碼」，再在這個群組輸入：綁定 123456（換成你的碼）");
      continue;
    }
    if (ev.type !== "message" || ev.message?.type !== "text" || !ev.replyToken) continue;
    const m = String(ev.message.text).match(/綁定\s*(\d{6})/);
    if (!m) continue;
    if (!gid) { await reply(cfg.token, ev.replyToken, "請把我加進家庭群組，在群組裡輸入綁定碼。"); continue; }
    const { data, error } = await db.rpc("line_bind", { p_code: m[1], p_group: gid });
    if (error) { console.error("bind", error.message); await reply(cfg.token, ev.replyToken, "綁定失敗，請稍後再試。"); continue; }
    await reply(cfg.token, ev.replyToken, data ? `✅ 已連結「${data}」。之後兌換申請、交辦完成、扣點、連續達成和每週報告都會傳到這裡。` : "綁定碼不對或已過期（30 分鐘有效），請在 App 重新產生。");
  }
  return new Response("ok");
});
