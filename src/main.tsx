import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { UiProvider } from "./ui/ui";
import { StoreProvider } from "./store";
import { registerSW } from "./push";

registerSW();
createRoot(document.getElementById("root")!).render(
  <StrictMode><UiProvider><StoreProvider><App /></StoreProvider></UiProvider></StrictMode>,
);
