import { bootstrap } from "./bootstrap.js";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status");
const form = document.querySelector<HTMLFormElement>("#napplet-loader");
const input = document.querySelector<HTMLInputElement>("#coordinate");
const button = form?.querySelector<HTMLButtonElement>("button[type=submit]");
const loaderStatus = document.querySelector<HTMLElement>("#loader-status");
const connectAccount = document.querySelector<HTMLButtonElement>("#connect-account");
const signOut = document.querySelector<HTMLButtonElement>("#sign-out");
const accountStatus = document.querySelector<HTMLElement>("#account-status");

const setLoaderStatus = (message: string, state: "idle" | "busy" | "success" | "error" = "idle"): void => {
  if (!loaderStatus) return;
  loaderStatus.textContent = message;
  loaderStatus.dataset.state = state;
};

void bootstrap().then((platform) => {
  if (import.meta.env.VITE_INSTALL_FIXTURE === "true") {
    Object.defineProperty(window, "__platformTest", { value: platform, configurable: true });
  }
  if (button) button.disabled = false;

  const renderAccount = (): void => {
    const pubkey = platform.activeAccountPubkey;
    if (accountStatus) accountStatus.textContent = pubkey ? `Active: ${pubkey.slice(0, 12)}…${pubkey.slice(-8)}` : "No active identity";
    if (connectAccount) connectAccount.hidden = Boolean(pubkey);
    if (signOut) signOut.hidden = !pubkey;
  };
  renderAccount();
  if (connectAccount) connectAccount.disabled = false;
  connectAccount?.addEventListener("click", () => {
    connectAccount.disabled = true;
    if (accountStatus) accountStatus.textContent = "Waiting for Nostr extension…";
    void platform.connectExtension()
      .then(renderAccount)
      .catch((error: unknown) => {
        if (accountStatus) accountStatus.textContent = error instanceof Error ? error.message : "Unable to connect Nostr extension";
      })
      .finally(() => { connectAccount.disabled = false; });
  });
  signOut?.addEventListener("click", () => { platform.signOut(); renderAccount(); });

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
  if (status) status.textContent = "Platform ready";
  const initialCoordinate = new URL(location.href).searchParams.get("napplet");
  if (initialCoordinate && input) { input.value = initialCoordinate; void openCoordinate(); }
}).catch((error: unknown) => {
  if (status) status.textContent = `Startup failed: ${error instanceof Error ? error.message : "unknown error"}`;
});
