import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/ui/misc";
import "@/ui/styles.css";
import "./popup.css";
import { App } from "./app";

if (new URLSearchParams(location.search).has("tabId")) document.body.dataset.window = "";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
