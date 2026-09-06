import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { detectAppPlatform } from "./lib/platform";

// Android renders video in a SurfaceView below the WebView. Keep the document
// transparent there so the surface can become visible when App removes its
// opaque idle background.
document.documentElement.dataset.platform = detectAppPlatform();

// Last-resort net for anything the app forgot to catch (console-only; the
// React tree owns user-visible error surfaces).
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection", e.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
