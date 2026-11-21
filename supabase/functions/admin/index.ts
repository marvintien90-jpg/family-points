// 家庭點點樂：建立家庭、管理成員帳號（需要 service role，所以放在雲端函式）
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const DOMAIN = "members.family-points.app";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ok = (d: unknown) => new Response(JSON.stringify(d), { headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, "Content-Type": "application/json" } });
const idOk = (s: string) => /^[a-z0-9_.-]{3,30}$/.test(s);

async function caller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return null;
  const { data: m } = await admin.from("members").select("*").eq("id", data.user.id).single();
  return m;
}

async function makeUser(loginId: string, password: string) {
  if (!idOk(loginId)) throw new Error("登入帳號只能用 3 到 30 個小寫英文、數字、底線或點");
  if (password.length < 6) throw new Error("密碼至少 6 個字");
  const { data, error } = await admin.auth.admin.createUser({ email: `${loginId}@${DOMAIN}`, password, email_confirm: true });
  if (error) throw new Error(error.message.includes("already") ? "這個登入帳號已經有人用了" : error.message);
  return data.user!.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const loginId = String(b.login_id ?? "").trim().toLowerCase();

    if (b.action === "create_family") {
      const { count } = await admin.from("families").select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0 && Deno.env.get("ALLOW_NEW_FAMILY") !== "true") return fail("已經建立過家庭了，請用帳號登入", 403);
      const uid = await makeUser(loginId, String(b.password ?? ""));
      const { data: fam, error } = await admin.from("families").insert({ name: String(b.family_name || "我們家") }).select().single();
      if (error) throw error;
      const { error: e2 } = await admin.from("members").insert({ id: uid, family_id: fam.id, display_name: String(b.display_name || "爸爸"), role: "admin", avatar: b.avatar || "👨", login_id: loginId });
      if (e2) throw e2;
      return ok({ email: `${loginId}@${DOMAIN}` });
    }

    const me = await caller(req);
    if (!me) return fail("請先登入", 401);
    if (me.role !== "admin") return fail("只有管理員可以管理成員", 403);

    if (b.action === "create_member") {
      if (!["parent", "child", "guest"].includes(b.role)) return fail("身份不正確");
      const uid = await makeUser(loginId, String(b.password ?? ""));
      const { error } = await admin.from("members").insert({ id: uid, family_id: me.family_id, display_name: String(b.display_name || loginId), role: b.role, avatar: b.avatar || "🙂", login_id: loginId });
      if (error) { await admin.auth.admin.deleteUser(uid); throw error; }
      if (b.role === "child") await admin.rpc("seed_family_service", { p_family: me.family_id, p_child: uid });
      return ok({ id: uid });
    }
    const { data: target } = await admin.from("members").select("*").eq("id", b.member_id).eq("family_id", me.family_id).single();
    if (!target) return fail("找不到這位成員", 404);
    if (b.action === "reset_password") {
      if (String(b.password ?? "").length < 6) return fail("密碼至少 6 個字");
      const { error } = await admin.auth.admin.updateUserById(target.id, { password: b.password });
      if (error) throw error;
      return ok({ done: true });
    }
    if (b.action === "remove_member") {
      if (target.id === me.id) return fail("不能移除自己");
      await admin.auth.admin.deleteUser(target.id);
      return ok({ done: true });
    }
    return fail("未知的動作");
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
});
