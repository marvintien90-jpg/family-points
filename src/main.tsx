import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { UiProvider } from "./ui/ui";
import { StoreProvider } from "./store";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { registerSW } from "./push";

registerSW();
createRoot(document.getElementById("root")!).render(
  <StrictMode><ErrorBoundary><StoreProvider><UiProvider><ErrorBoundary><App /></ErrorBoundary></UiProvider></StoreProvider></ErrorBoundary></StrictMode>,
);
