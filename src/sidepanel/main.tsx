import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initMessageRouter } from "@/shared/messaging";
import App from "./App";
import "./index.css";

// Set up message listener so the side panel can receive
// DOM_EXTRACT_RESULT and EXTRACT_PROGRESS from content scripts.
initMessageRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
