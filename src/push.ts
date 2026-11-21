import { VAPID_PUBLIC_KEY } from "./config";
import { sb } from "./supabase";

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const pushPermission = () => (pushSupported() ? Notification.permission : "unsupported");

function key(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4), raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("./sw.js", { scope: "./" }); } catch { return null; }
}
async function save(sub: PushSubscription, memberId: string) {
  const j = sub.toJSON();
  await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  const { error } = await sb.from("push_subscriptions").insert({ member_id: memberId, endpoint: sub.endpoint, p256dh: j.keys!.p256dh, auth: j.keys!.auth });
  if (error) throw new Error(error.message);
}
// 必須在使用者按按鈕時呼叫（iOS 規定）
export async function enablePush(memberId: string) {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? "請先把 App 加入主畫面，再從主畫面打開" : "這個瀏覽器不支援通知");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("通知被拒絕了。請到 iPhone 設定 → 通知 → 點點樂 打開");
  const reg = (await navigator.serviceWorker.ready) ?? (await registerSW());
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC_KEY) }));
  await save(sub, memberId);
}
// 開 App 時同步一次訂閱（訂閱可能被系統換掉）
export async function syncPush(memberId: string) {
  if (pushPermission() !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC_KEY) }));
    const { data } = await sb.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle();
    if (!data) await save(sub, memberId);
  } catch { /* 下次再試 */ }
}
export async function clearBadge() {
  try { const n = navigator as unknown as { clearAppBadge?: () => Promise<void> }; await n.clearAppBadge?.(); } catch { /* ignore */ }
}
