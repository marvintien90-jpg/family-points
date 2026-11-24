import { useEffect, useState } from "react";
import { sb } from "../supabase";

// 任務照片：私人儲存空間，用一小時有效的連結顯示
export function Photo({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { sb.storage.from("task-photos").createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null)); }, [path]);
  return url ? <img className="q-photo" src={url} alt="任務照片" /> : <div className="q-photo ph" aria-label="照片載入中" />;
}

async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file); const s = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.82));
}

// 縮小後上傳，回傳儲存路徑（家庭 id 開頭，只有同一家人看得到）
export async function uploadPhoto(familyId: string, file: File): Promise<string> {
  const blob = await shrink(file); const path = `${familyId}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from("task-photos").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}
