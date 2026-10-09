import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { useStore } from "./lib/store";
import { engine } from "./lib/engine";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// debug/testing handle (harmless in production, handy in the console and for automation)
(window as any).__lds = { useStore, engine };
