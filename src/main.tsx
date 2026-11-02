import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { SPIN_TOKEN, startMirrorSync, startUploadSync } from "./lib/backend";
import { preloadFrames } from "./lib/frameAssets";
import { useStudio } from "./lib/store";
import { subscribeTemplates, templates } from "./templates";
// Warm the frames in the background, after the one on screen. Themes come
// from the backend, so wait briefly for its list instead of also downloading
// the built-in frames; they load only if the backend doesn't answer.
const warmFrames = () =>
  void preloadFrames([...templates], useStudio.getState().template);
// Only customers see mirrors; the manager form stays light.
if (SPIN_TOKEN) {
  let fromBackend = false;
  subscribeTemplates(() => {
    fromBackend = true;
    warmFrames();
  });
  setTimeout(() => {
    if (!fromBackend) warmFrames();
  }, 2500);
  startMirrorSync();
}
// A page left open across a deploy asks for code that has since been replaced:
// reload onto the new version, once, so a real outage can't loop.
addEventListener("vite:preloadError", (e) => {
  try {
    if (sessionStorage.getItem("sky-reloaded")) return;
    sessionStorage.setItem("sky-reloaded", "1");
  } catch {
    return;
  }
  e.preventDefault();
  location.reload();
});
startMirrorSync();
startUploadSync();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
