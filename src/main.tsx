import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL
    });
  });
}

if (import.meta.env.PROD) {
  const reloadKey = "auction-radar:auto-reload-build";

  async function checkForNewBuild() {
    if (document.visibilityState === "hidden") return;
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`,
        {
          cache: "no-store"
        }
      );
      if (!response.ok) return;
      const version = (await response.json()) as { buildId?: string };
      if (!version.buildId || version.buildId === __BUILD_ID__) return;
      if (sessionStorage.getItem(reloadKey) === version.buildId) return;
      sessionStorage.setItem(reloadKey, version.buildId);
      window.location.reload();
    } catch {
      // Version checks are best-effort; cached data remains available offline.
    }
  }

  window.setInterval(() => void checkForNewBuild(), 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForNewBuild();
  });
}
