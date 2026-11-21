import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Login } from "./Login";
import { KidApp } from "./kid/KidApp";
import { ParentApp } from "./parent/ParentApp";
import { clearBadge, isIOS, isStandalone, syncPush } from "./push";
import { rpc, sb } from "./supabase";

export default function App() {
  const { session, me, loading } = useStore();
  const [skipInstall, setSkipInstall] = useState(false);

  useEffect(() => {
    if (!me) return;
    syncPush(me.id); clearBadge(); rpc("mark_notifications_read").catch(() => {});
  }, [me?.id]);

  // 彈出視窗畫在 App 外面，所以把配色放在 body 上，彈窗按鈕才有顏色
  const mode = me?.role === "child" ? "mode-kid" : "mode-parent";
  useEffect(() => { document.body.classList.remove("mode-kid", "mode-parent"); document.body.classList.add(mode); }, [mode]);

  if (loading) return <div className="center-page"><div className="spinner" /></div>;
  if (isIOS() && !isStandalone() && !skipInstall) return <InstallGuide onSkip={() => setSkipInstall(true)} />;
  if (!session) return <Login />;
  if (!me) return <div className="center-page mode-kid"><h1>找不到你的家庭</h1><p>這個帳號還沒有加入家庭，請管理員幫你建立帳號。</p><button className="btn" onClick={() => sb.auth.signOut()}>登出</button></div>;
  return me.role === "child" ? <KidApp /> : <ParentApp />;
}

function InstallGuide({ onSkip }: { onSkip: () => void }) {
  return <div className="center-page mode-kid">
    <img className="logo" src="./icon-192.png" alt="" />
    <h1>先把點點樂加到主畫面</h1>
    <p>加到主畫面後才能收到通知，用起來也跟一般 App 一樣。</p>
    <div className="card steps">
      <div className="step"><span className="dot">1</span>按 Safari 下方的「分享」按鈕 <b>⬆︎</b></div>
      <div className="step"><span className="dot">2</span>往下找「加入主畫面」</div>
      <div className="step"><span className="dot">3</span>按「新增」，再從主畫面的點點樂圖示打開</div>
    </div>
    <button className="link" onClick={onSkip}>先在瀏覽器裡看看</button>
  </div>;
}
