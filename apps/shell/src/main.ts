import { bootstrap } from "./bootstrap.js";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status");
void bootstrap().then((platform) => {
  if (import.meta.env.VITE_INSTALL_FIXTURE === "true") {
    Object.defineProperty(window, "__platformTest", { value: platform, configurable: true });
  }
  if (status) status.textContent = "Platform ready";
}).catch((error: unknown) => {
  if (status) status.textContent = `Startup failed: ${error instanceof Error ? error.message : "unknown error"}`;
});
