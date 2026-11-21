import { FormEvent, useState } from "react";
import { LOGIN_DOMAIN } from "./config";
import { adminCall, sb } from "./supabase";

export function Login() {
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [loginId, setLoginId] = useState(""); const [pw, setPw] = useState("");
  const [fam, setFam] = useState("我們家"); const [name, setName] = useState("爸爸");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const id = loginId.trim().toLowerCase();
      if (mode === "setup") await adminCall({ action: "create_family", family_name: fam, display_name: name, login_id: id, password: pw, avatar: "👨" });
      const { error } = await sb.auth.signInWithPassword({ email: `${id}@${LOGIN_DOMAIN}`, password: pw });
      if (error) throw new Error(error.message.includes("Invalid") ? "帳號或密碼不對" : error.message);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  }

  return <form className="center-page mode-kid" onSubmit={submit}>
    <img className="logo" src="./icon-192.png" alt="" />
    <h1>{mode === "login" ? "家庭點點樂" : "建立我們家"}</h1>
    <p>{mode === "login" ? "用家長幫你建立的帳號登入" : "第一次使用：建立家庭和管理員帳號"}</p>
    <div className="card">
      {mode === "setup" && <>
        <label className="field">家庭名稱<input type="text" id="fam" value={fam} onChange={(e) => setFam(e.target.value)} /></label>
        <label className="field">你的稱呼<input type="text" id="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      </>}
      <label className="field">登入帳號（小寫英文或數字）<input type="text" id="login" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} required /></label>
      <label className="field">密碼<input type="password" id="pw" autoComplete={mode === "login" ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} /></label>
      {err && <div className="err">{err}</div>}
      <button className="btn block" disabled={busy}>{busy ? "請稍候…" : mode === "login" ? "登入" : "建立並登入"}</button>
    </div>
    <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "setup" : "login"); setErr(""); }}>
      {mode === "login" ? "第一次使用？建立家庭" : "已經有帳號了，去登入"}
    </button>
  </form>;
}
