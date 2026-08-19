import { bootstrap } from "./bootstrap.js";
import { gsap } from "gsap";
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
const profileActions = Array.from(document.querySelectorAll<HTMLButtonElement>(".profile-action"));
const spotlightTrigger = document.querySelector<HTMLButtonElement>("#spotlight-trigger");
const spotlightPanel = document.querySelector<HTMLElement>("#spotlight-panel");
const spotlightIcon = spotlightPanel?.querySelector<SVGElement>(".spotlight-icon");
const loaderProgress = document.querySelector<HTMLElement>("#loader-progress");
const windowsContainer = document.querySelector<HTMLElement>("#windows");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let loadingTimeline: gsap.core.Timeline | null = null;
let accountTimeline: gsap.core.Timeline | null = null;
let accountOpen = false;

profileImage?.addEventListener("error", () => {
  profileImage.hidden = true;
  profileImage.removeAttribute("src");
});

const setExpanded = (trigger: HTMLButtonElement | null, panel: HTMLElement | null, open: boolean): void => {
  if (!trigger || !panel) return;
  trigger.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
};

const closeSpotlight = (): void => {
  if (!spotlightTrigger || !spotlightPanel || spotlightPanel.hidden) return;
  spotlightTrigger.setAttribute("aria-expanded", "false");
  gsap.killTweensOf(spotlightPanel);
  if (reducedMotion.matches) {
    spotlightPanel.hidden = true;
    return;
  }
  gsap.to(spotlightPanel, {
    autoAlpha: 0,
    y: -8,
    scale: .985,
    filter: "blur(4px)",
    duration: .14,
    ease: "power2.in",
    onComplete: () => {
      spotlightPanel.hidden = true;
      gsap.set(spotlightPanel, { clearProps: "opacity,visibility,transform,filter" });
    }
  });
};

const radialPosition = (index: number): { x: number; y: number } => {
  const angle = (10 + index * 26) * Math.PI / 180;
  const radius = 112;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};

const buildAccountTimeline = (): gsap.core.Timeline => {
  if (accountTimeline) return accountTimeline;
  const positions = profileActions.map((action, index) => radialPosition(Number(action.dataset.radialSlot ?? index)));
  gsap.set(profileActions, { x: 0, y: 0, autoAlpha: 0, scale: 0 });
  accountTimeline = gsap.timeline({
    paused: true,
    onReverseComplete: () => {
      if (accountPopover) accountPopover.hidden = true;
    }
  });
  profileActions.forEach((action, index) => {
    accountTimeline?.to(action, {
      ...positions[index],
      autoAlpha: 1,
      scale: 1,
      rotation: 0,
      duration: .6,
      ease: "elastic.out(1, 0.5)",
      easeReverse: "power3.in"
    }, index * .05);
  });
  accountTimeline.to(".profile-avatar", { scale: 1.08, duration: .32, ease: "back.out(1.7)", easeReverse: true }, 0);
  return accountTimeline;
};

const closeAccountMenu = (): void => {
  if (!profileTrigger || !accountPopover || !accountOpen) return;
  accountOpen = false;
  profileTrigger.setAttribute("aria-expanded", "false");
  if (reducedMotion.matches) {
    accountPopover.hidden = true;
    return;
  }
  buildAccountTimeline().timeScale(1.8).reverse();
};

const openAccountMenu = (): void => {
  if (!profileTrigger || !accountPopover) return;
  closeSpotlight();
  accountOpen = true;
  profileTrigger.setAttribute("aria-expanded", "true");
  accountPopover.hidden = false;
  const positions = profileActions.map((action, index) => radialPosition(Number(action.dataset.radialSlot ?? index)));
  if (reducedMotion.matches) {
    profileActions.forEach((action, index) => gsap.set(action, { ...positions[index], autoAlpha: 1, scale: 1 }));
    return;
  }
  buildAccountTimeline().timeScale(1).play();
};

const closeMenus = (): void => {
  closeAccountMenu();
  closeSpotlight();
};

profileTrigger?.addEventListener("click", () => {
  if (!accountOpen) openAccountMenu();
  else closeAccountMenu();
});

profileActions.filter((action) => action.dataset.stub).forEach((action) => action.addEventListener("click", () => {
  if (accountStatus) accountStatus.textContent = `${action.dataset.stub} is coming soon.`;
  if (!reducedMotion.matches) gsap.fromTo(action, { scale: .88 }, { scale: 1, duration: .34, ease: "elastic.out(1, 0.45)" });
}));

const openSpotlight = (): void => {
  closeMenus();
  if (!spotlightTrigger || !spotlightPanel) return;
  spotlightTrigger.setAttribute("aria-expanded", "true");
  spotlightPanel.hidden = false;
  gsap.killTweensOf(spotlightPanel);
  if (reducedMotion.matches) {
    input?.focus();
    return;
  }
  gsap.fromTo(spotlightPanel,
    { autoAlpha: 0, y: -14, scale: .965, filter: "blur(8px)", transformOrigin: "78% top" },
    { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", duration: .32, ease: "power4.out", clearProps: "filter", onComplete: () => input?.focus() }
  );
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

const animateLoading = (): void => {
  if (reducedMotion.matches || !loaderProgress) return;
  loadingTimeline?.kill();
  loadingTimeline = gsap.timeline();
  loadingTimeline
    .set(loaderProgress, { autoAlpha: 1, scaleX: 0, transformOrigin: "left center" })
    .to(loaderProgress, { scaleX: 1, duration: .9, ease: "power2.inOut", repeat: -1, yoyo: true });
  if (loaderStatus) gsap.fromTo(loaderStatus, { autoAlpha: .35, y: 4 }, { autoAlpha: 1, y: 0, duration: .22, ease: "power2.out" });
  if (spotlightIcon) gsap.to(spotlightIcon, { rotation: 10, scale: 1.06, duration: .55, ease: "sine.inOut", repeat: -1, yoyo: true, transformOrigin: "center" });
};

const settleLoading = (state: "success" | "error"): void => {
  loadingTimeline?.kill();
  loadingTimeline = null;
  gsap.killTweensOf([loaderProgress, spotlightIcon, loaderStatus, form]);
  if (reducedMotion.matches) return;
  if (loaderProgress) {
    gsap.to(loaderProgress, { scaleX: state === "success" ? 1 : 0, autoAlpha: state === "success" ? 1 : 0, duration: .24, ease: "power3.out" });
  }
  if (spotlightIcon) gsap.to(spotlightIcon, { rotation: 0, scale: 1, duration: .2, ease: "power2.out" });
  if (loaderStatus) gsap.fromTo(loaderStatus, { autoAlpha: .2, y: 3 }, { autoAlpha: 1, y: 0, duration: .24, ease: "power3.out" });
  if (state === "error" && form) {
    gsap.fromTo(form, { x: -5 }, { x: 0, duration: .36, ease: "elastic.out(1, 0.35)", clearProps: "transform" });
  }
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

  const openedCoordinates = new Map<string, string>();
  windowsContainer?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const closeButton = target.closest<HTMLButtonElement>(".napplet-window-close");
    const windowId = closeButton?.dataset.windowId;
    const coordinate = windowId ? openedCoordinates.get(windowId) : undefined;
    if (!windowId || !coordinate) return;
    openedCoordinates.delete(windowId);
    const url = new URL(location.href);
    const coordinates = url.searchParams.getAll("napplet");
    url.searchParams.delete("napplet");
    let removed = false;
    for (const value of coordinates) {
      if (!removed && value === coordinate) { removed = true; continue; }
      url.searchParams.append("napplet", value);
    }
    history.replaceState(null, "", url);
  });

  const openCoordinate = async (requestedCoordinate?: string, updateUrl = true): Promise<void> => {
    if (!input || !button) return;
    const coordinate = (requestedCoordinate ?? input.value).trim();
    if (!coordinate) return;
    button.disabled = true;
    button.textContent = "Opening…";
    input.setAttribute("aria-invalid", "false");
    setLoaderStatus("Resolving signed manifest and verifying package…", "busy");
    animateLoading();
    try {
      const opened = await platform.installAndOpen(coordinate);
      openedCoordinates.set(opened.windowId, coordinate);
      if (!requestedCoordinate || input.value.trim() === coordinate) input.value = "";
      if (updateUrl) {
        const url = new URL(location.href);
        url.searchParams.append("napplet", coordinate);
        history.replaceState(null, "", url);
      }
      setLoaderStatus(`Opened ${opened.title}.`, "success");
      settleLoading("success");
      setTimeout(() => closeMenus(), 500);
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      setLoaderStatus(error instanceof Error ? error.message : "Unable to open Napplet", "error");
      settleLoading("error");
    } finally {
      button.disabled = false;
      button.textContent = "Open Napplet";
    }
  };

  form?.addEventListener("submit", (event) => { event.preventDefault(); void openCoordinate(); });
  if (status) status.textContent = "Platform ready";
  const initialCoordinates = new URL(location.href).searchParams.getAll("napplet").filter(Boolean);
  if (initialCoordinates.length > 0) {
    void (async () => {
      for (const coordinate of initialCoordinates) await openCoordinate(coordinate, false);
    })();
  }
}).catch((error: unknown) => {
  if (status) status.textContent = `Startup failed: ${error instanceof Error ? error.message : "unknown error"}`;
});
