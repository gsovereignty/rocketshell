import { bootstrap } from "./bootstrap.js";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status");
const form = document.querySelector<HTMLFormElement>("#napplet-loader");
const input = document.querySelector<HTMLInputElement>("#coordinate");
const button = form?.querySelector<HTMLButtonElement>("button[type=submit]");
const loaderStatus = document.querySelector<HTMLElement>("#loader-status");

const setLoaderStatus = (message: string, state: "idle" | "busy" | "success" | "error" = "idle"): void => {
  if (!loaderStatus) return;
  loaderStatus.textContent = message;
  loaderStatus.dataset.state = state;
};

void bootstrap().then((platform) => {
  if (import.meta.env.VITE_INSTALL_FIXTURE === "true") {
    Object.defineProperty(window, "__platformTest", { value: platform, configurable: true });
  }
  if (status) status.textContent = "Platform ready";
  if (button) button.disabled = false;

  const openCoordinate = async (): Promise<void> => {
    if (!input || !button) return;
    const coordinate = input.value.trim();
    if (!coordinate) return;
    button.disabled = true;
    button.textContent = "Opening…";
    input.setAttribute("aria-invalid", "false");
    setLoaderStatus("Resolving signed manifest and verifying package…", "busy");
    try {
      const opened = await platform.installAndOpen(coordinate);
      const url = new URL(location.href);
      url.searchParams.set("napplet", coordinate);
      history.replaceState(null, "", url);
      setLoaderStatus(`Opened ${opened.title}.`, "success");
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      setLoaderStatus(error instanceof Error ? error.message : "Unable to open Napplet", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Open Napplet";
    }
  };

  form?.addEventListener("submit", (event) => { event.preventDefault(); void openCoordinate(); });
  const initialCoordinate = new URL(location.href).searchParams.get("napplet");
  if (initialCoordinate && input) { input.value = initialCoordinate; void openCoordinate(); }
}).catch((error: unknown) => {
  if (status) status.textContent = `Startup failed: ${error instanceof Error ? error.message : "unknown error"}`;
});
