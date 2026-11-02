import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startMirrorSync, startUploadSync } from "./lib/backend";
import { preloadFrames } from "./lib/frameAssets";
import { useStudio } from "./lib/store";
import { subscribeTemplates, templates } from "./templates";
// Warm the frames in the background, after the one on screen. Themes come
// from the backend, so wait briefly for its list instead of also downloading
// the built-in frames; they load only if the backend doesn't answer.
const warmFrames = () =>
  void preloadFrames([...templates], useStudio.getState().template);
let fromBackend = false;
subscribeTemplates(() => {
  fromBackend = true;
  warmFrames();
});
setTimeout(() => {
  if (!fromBackend) warmFrames();
}, 2500);
startMirrorSync();
startUploadSync();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
