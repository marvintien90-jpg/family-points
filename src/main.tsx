import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./polish.css";
import App from "./App";
import { UiProvider } from "./ui/ui";
import { StoreProvider } from "./store";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { registerSW } from "./push";

registerSW();
createRoot(document.getElementById("root")!).render(
  <StrictMode><ErrorBoundary><StoreProvider><UiProvider><ErrorBoundary><App /></ErrorBoundary></UiProvider></StoreProvider></ErrorBoundary></StrictMode>,
);

// 按鈕漣漪：記下按的位置，播放一次光暈
document.addEventListener("pointerdown", (e) => {
  const b = (e.target as HTMLElement).closest?.(".btn") as HTMLElement | null; if (!b) return;
  const r = b.getBoundingClientRect(); b.style.setProperty("--rx", `${e.clientX - r.left}px`); b.style.setProperty("--ry", `${e.clientY - r.top}px`);
  b.classList.remove("rippling"); void b.offsetWidth; b.classList.add("rippling");
}, { passive: true });
