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
const profileTrigger = document.querySelector<HTMLButtonElement>("#profile-menu-trigger");
const profileLabel = document.querySelector<HTMLElement>("#profile-menu-label");
const profileImage = document.querySelector<HTMLImageElement>("#profile-avatar-image");
const profileFallback = document.querySelector<HTMLElement>("#profile-avatar-fallback");
const accountPopover = document.querySelector<HTMLElement>("#account-popover");
const spotlightTrigger = document.querySelector<HTMLButtonElement>("#spotlight-trigger");
const spotlightPanel = document.querySelector<HTMLElement>("#spotlight-panel");

profileImage?.addEventListener("error", () => {
  profileImage.hidden = true;
  profileImage.removeAttribute("src");
});

const setExpanded = (trigger: HTMLButtonElement | null, panel: HTMLElement | null, open: boolean): void => {
  if (!trigger || !panel) return;
  trigger.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
};

const closeMenus = (): void => {
  setExpanded(profileTrigger, accountPopover, false);
  setExpanded(spotlightTrigger, spotlightPanel, false);
};

profileTrigger?.addEventListener("click", () => {
  const open = accountPopover?.hidden ?? true;
  closeMenus();
  setExpanded(profileTrigger, accountPopover, open);
});

const openSpotlight = (): void => {
  closeMenus();
  setExpanded(spotlightTrigger, spotlightPanel, true);
  input?.focus();
};

spotlightTrigger?.addEventListener("click", () => spotlightPanel?.hidden ? openSpotlight() : closeMenus());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const returnFocus = spotlightPanel?.hidden === false ? spotlightTrigger : profileTrigger;
    closeMenus();
    returnFocus?.focus();
  } else if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    openSpotlight();
  }
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (accountPopover?.contains(target) || profileTrigger?.contains(target) || spotlightPanel?.contains(target) || spotlightTrigger?.contains(target)) return;
  closeMenus();
});

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

  let accountRender = 0;
  const renderAccount = async (): Promise<void> => {
    const renderId = ++accountRender;
    const pubkey = platform.activeAccountPubkey;
    if (accountStatus) accountStatus.textContent = pubkey ? `Active: ${pubkey.slice(0, 12)}…${pubkey.slice(-8)}` : "No active identity";
    if (connectAccount) connectAccount.hidden = Boolean(pubkey);
    if (signOut) signOut.hidden = !pubkey;
    if (!pubkey) {
      if (profileLabel) profileLabel.textContent = "Not connected";
      if (profileFallback) profileFallback.textContent = "K";
      if (profileImage) { profileImage.hidden = true; profileImage.removeAttribute("src"); }
      return;
    }
    if (profileLabel) profileLabel.textContent = `${pubkey.slice(0, 8)}…`;
    if (profileFallback) profileFallback.textContent = pubkey.slice(0, 2).toUpperCase();
    const profile = await platform.activeAccountProfile();
    if (renderId !== accountRender || pubkey !== platform.activeAccountPubkey) return;
    const name = profile?.displayName || profile?.name;
    if (profileLabel) profileLabel.textContent = name || `${pubkey.slice(0, 8)}…`;
    if (profileFallback) profileFallback.textContent = (name || pubkey).slice(0, 2).toUpperCase();
    if (profileImage) {
      const picture = profile?.picture;
      const validPicture = picture && (() => { try { return ["https:", "http:"].includes(new URL(picture).protocol); } catch { return false; } })();
      if (validPicture) { profileImage.src = picture; profileImage.hidden = false; }
      else { profileImage.hidden = true; profileImage.removeAttribute("src"); }
    }
  };
  void renderAccount();
  if (connectAccount) connectAccount.disabled = false;
  connectAccount?.addEventListener("click", () => {
    connectAccount.disabled = true;
    if (accountStatus) accountStatus.textContent = "Waiting for Nostr extension…";
    void platform.connectExtension()
      .then(() => renderAccount())
      .catch((error: unknown) => {
        if (accountStatus) accountStatus.textContent = error instanceof Error ? error.message : "Unable to connect Nostr extension";
      })
      .finally(() => { connectAccount.disabled = false; });
  });
  signOut?.addEventListener("click", () => { platform.signOut(); void renderAccount(); closeMenus(); });

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
      input.value = "";
      const url = new URL(location.href);
      url.searchParams.set("napplet", coordinate);
      history.replaceState(null, "", url);
      setLoaderStatus(`Opened ${opened.title}.`, "success");
      setTimeout(() => closeMenus(), 500);
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
