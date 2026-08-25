import { combineLatest } from "rxjs";
import { bootstrap } from "./bootstrap.js";
import { createShellSettingsStore } from "@platform/host-services";
import { connectedRelayCount$, connectedRelays$ } from "@platform/nostr-engine";
import { activePubkey$, activeProfile$, getSeenRelaysForEvent, signedEvents$ } from "./nostr.js";
import { gsap } from "gsap";
import { DEFAULT_SHELL_SETTINGS } from "./platform.js";
import { createSettingsView, createThemeController, resolveTheme, type SettingsView } from "./settings-view.js";
import { createWidgetGrid } from "./widget-layout.js";
import { createWindowSessionStore, type WindowSession } from "./open-napplets-store.js";
import { createDockStore } from "./dock-store.js";
import type { DockLauncher } from "./dock-launchers.js";
import { openDockIconStore, type DockIconOverride } from "./dock-icon-store.js";
import { createSignedEventsView } from "./signed-events-view.js";
import { createNappletConsoleView } from "./napplet-console-view.js";
import { cacheBustedShellUrl, resetShellRuntime } from "./hard-reset.js";
import "./style.css";

// Paint the stored theme before the asynchronous platform boot, otherwise a light-theme user gets a
// flash of the dark palette while IndexedDB and the service worker come up.
document.documentElement.setAttribute("data-theme", resolveTheme(
  createShellSettingsStore(localStorage, DEFAULT_SHELL_SETTINGS).get().theme,
  window.matchMedia("(prefers-color-scheme: dark)").matches
));

const status = document.querySelector<HTMLElement>("#status");
const relayStatus = document.querySelector<HTMLButtonElement>("#relay-status");
const relayPopover = document.querySelector<HTMLElement>("#relay-popover");
const relayPopoverList = document.querySelector<HTMLUListElement>("#relay-popover-list");
const relayPopoverEmpty = document.querySelector<HTMLElement>("#relay-popover-empty");
const form = document.querySelector<HTMLFormElement>("#napplet-loader");
const input = document.querySelector<HTMLInputElement>("#coordinate");
const button = form?.querySelector<HTMLButtonElement>("button[type=submit]");
const loaderStatus = document.querySelector<HTMLElement>("#loader-status");
const connectAccount = document.querySelector<HTMLButtonElement>("#connect-account");
const connectEphemeral = document.querySelector<HTMLButtonElement>("#connect-ephemeral");
const signOut = document.querySelector<HTMLButtonElement>("#sign-out");
const accountStatus = document.querySelector<HTMLElement>("#account-status");
const profileTrigger = document.querySelector<HTMLButtonElement>("#profile-menu-trigger");
const profileLabel = document.querySelector<HTMLElement>("#profile-menu-label");
const profileImage = document.querySelector<HTMLImageElement>("#profile-avatar-image");
const profileFallback = document.querySelector<HTMLElement>("#profile-avatar-fallback");
const accountPopover = document.querySelector<HTMLElement>("#account-popover");
const profileActions = Array.from(document.querySelectorAll<HTMLButtonElement>(".profile-action"));
const spotlightTrigger = document.querySelector<HTMLButtonElement>("#spotlight-trigger");
const signedEventsTrigger = document.querySelector<HTMLButtonElement>("#signed-events-trigger");
const signedEventsCount = document.querySelector<HTMLElement>("#signed-events-count");
const signedEventsPanel = document.querySelector<HTMLElement>("#signed-events-panel");
const signedEventsClose = document.querySelector<HTMLButtonElement>("#signed-events-close");
const signedEventsList = document.querySelector<HTMLUListElement>("#signed-events-list");
const signedEventsEmpty = document.querySelector<HTMLElement>("#signed-events-empty");
const signedEventDialog = document.querySelector<HTMLDialogElement>("#signed-event-dialog");
const signedEventDialogTitle = document.querySelector<HTMLElement>("#signed-event-dialog-title");
const signedEventRelaysList = document.querySelector<HTMLUListElement>("#signed-event-relays-list");
const signedEventRelaysEmpty = document.querySelector<HTMLElement>("#signed-event-relays-empty");
const signedEventCode = document.querySelector<HTMLElement>("#signed-event-code");
const signedEventDialogClose = document.querySelector<HTMLButtonElement>("#signed-event-dialog-close");
const spotlightPanel = document.querySelector<HTMLElement>("#spotlight-panel");
const spotlightIcon = spotlightPanel?.querySelector<SVGElement>(".spotlight-icon");
const loaderProgress = document.querySelector<HTMLElement>("#loader-progress");
const settingsTrigger = document.querySelector<HTMLButtonElement>("#settings-trigger");
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const settingsTabs = document.querySelector<HTMLElement>("#settings-tabs");
const settingsBody = document.querySelector<HTMLElement>("#settings-body");
const settingsStatus = document.querySelector<HTMLElement>("#settings-status");
const settingsClose = document.querySelector<HTMLButtonElement>("#settings-close");
const windowsContainer = document.querySelector<HTMLElement>("#windows");
const screenNavigation = document.querySelector<HTMLElement>("#screen-nav");
const dockShell = document.querySelector<HTMLElement>("#dock-shell");
const dock = document.querySelector<HTMLElement>("#napplet-dock");
const dockItems = document.querySelector<HTMLUListElement>("#dock-items");
const dockStatus = document.querySelector<HTMLElement>("#dock-status");
const consoleTrigger = document.querySelector<HTMLButtonElement>("#napplet-console-trigger");
const consolePanel = document.querySelector<HTMLElement>("#napplet-console-panel");
const consoleHeader = document.querySelector<HTMLElement>("#napplet-console-header");
const consoleClose = document.querySelector<HTMLButtonElement>("#napplet-console-close");
const consoleClear = document.querySelector<HTMLButtonElement>("#napplet-console-clear");
const consoleTabs = document.querySelector<HTMLElement>("#napplet-console-tabs");
const consoleOutput = document.querySelector<HTMLElement>("#napplet-console-output");
const consoleEmpty = document.querySelector<HTMLElement>("#napplet-console-empty");
const hardResetTrigger = document.querySelector<HTMLButtonElement>("#hard-reset-trigger");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = window.matchMedia("(hover: none)");
const platformLoader = status?.querySelector<HTMLElement>(".platform-loader");
const platformLoadingTween = platformLoader && !reducedMotion.matches
  ? gsap.to(platformLoader, { rotation: 360, duration: 1.15, ease: "none", repeat: -1, transformOrigin: "center" })
  : null;
const syncPlatformLoader = (): void => {
  if (document.hidden) platformLoadingTween?.pause();
  else platformLoadingTween?.resume();
};
document.addEventListener("visibilitychange", syncPlatformLoader);

hardResetTrigger?.addEventListener("click", () => {
  const confirmed = window.confirm("Hard reset shell cache and reload? Open Napplet work may be interrupted.");
  if (!confirmed) return;
  hardResetTrigger.disabled = true;
  hardResetTrigger.setAttribute("aria-busy", "true");
  hardResetTrigger.setAttribute("aria-label", "Resetting shell cache");
  const scopeUrl = new URL(import.meta.env.BASE_URL, window.location.href).href;
  void resetShellRuntime(navigator.serviceWorker, window.caches, scopeUrl).then(() => {
    window.location.replace(cacheBustedShellUrl(window.location.href, crypto.randomUUID()));
  }).catch((error: unknown) => {
    console.error("Hard reset of shell worker and caches failed", { scopeUrl, error });
    hardResetTrigger.disabled = false;
    hardResetTrigger.removeAttribute("aria-busy");
    hardResetTrigger.setAttribute("aria-label", "Hard reset shell cache");
    window.alert("Shell reset failed. Open browser site settings and clear this site's data, then reload.");
  });
});
const widgetGrid = windowsContainer
  ? createWidgetGrid(windowsContainer, reducedMotion, window.localStorage, screenNavigation ?? undefined)
  : null;
let loadingTimeline: gsap.core.Timeline | null = null;
let accountTimeline: gsap.core.Timeline | null = null;
let accountOpen = false;
let relayPopoverOpen = false;
let settingsView: SettingsView | null = null;
const signedEventsView = signedEventsTrigger && signedEventsCount && signedEventsPanel && signedEventsClose && signedEventsList && signedEventsEmpty && signedEventDialog && signedEventDialogTitle && signedEventRelaysList && signedEventRelaysEmpty && signedEventCode && signedEventDialogClose
  ? createSignedEventsView({
    trigger: signedEventsTrigger, count: signedEventsCount, panel: signedEventsPanel, close: signedEventsClose,
    list: signedEventsList, empty: signedEventsEmpty, dialog: signedEventDialog,
    dialogTitle: signedEventDialogTitle, relayList: signedEventRelaysList, relayEmpty: signedEventRelaysEmpty,
    code: signedEventCode, dialogClose: signedEventDialogClose
  }, signedEvents$, reducedMotion, () => { closeAccountMenu(); closeSpotlight(); closeSettings(); closeRelayPopover(); }, getSeenRelaysForEvent)
  : null;
let dockHideTimer: number | undefined;

const relayCountSubscription = connectedRelayCount$.subscribe((count) => {
  const label = `${count} ${count === 1 ? "relay" : "relays"} connected`;
  relayStatus?.querySelector("span")?.replaceChildren(String(count));
  relayStatus?.setAttribute("aria-label", label);
  relayStatus?.setAttribute("title", label);
  if (relayStatus) relayStatus.dataset.connected = String(count > 0);
});
const connectedRelaysSubscription = connectedRelays$.subscribe((relays) => {
  if (!relayPopoverList || !relayPopoverEmpty) return;
  relayPopoverList.replaceChildren(...relays.map((url) => {
    const item = document.createElement("li");
    const indicator = document.createElement("span");
    const label = document.createElement("code");
    indicator.className = "relay-connected-dot";
    indicator.setAttribute("aria-hidden", "true");
    label.textContent = url;
    item.append(indicator, label);
    return item;
  }));
  relayPopoverEmpty.hidden = relays.length > 0;
  relayPopoverList.hidden = relays.length === 0;
});
window.addEventListener("pagehide", () => {
  relayCountSubscription.unsubscribe();
  connectedRelaysSubscription.unsubscribe();
}, { once: true });

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

const closeRelayPopover = (): void => {
  if (!relayStatus || !relayPopover || !relayPopoverOpen) return;
  relayPopoverOpen = false;
  relayStatus.setAttribute("aria-expanded", "false");
  gsap.killTweensOf(relayPopover);
  if (reducedMotion.matches) {
    relayPopover.hidden = true;
    return;
  }
  gsap.to(relayPopover, {
    autoAlpha: 0, y: -6, scale: .98, duration: .14, ease: "power2.in",
    onComplete: () => {
      relayPopover.hidden = true;
      gsap.set(relayPopover, { clearProps: "opacity,visibility,transform" });
    }
  });
};

const openRelayPopover = (): void => {
  if (!relayStatus || !relayPopover) return;
  closeMenus();
  relayPopoverOpen = true;
  relayStatus.setAttribute("aria-expanded", "true");
  relayPopover.hidden = false;
  gsap.killTweensOf(relayPopover);
  if (reducedMotion.matches) return;
  gsap.fromTo(relayPopover,
    { autoAlpha: 0, y: -8, scale: .97, transformOrigin: "right top" },
    { autoAlpha: 1, y: 0, scale: 1, duration: .24, ease: "power3.out", clearProps: "opacity,visibility,transform" }
  );
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
  closeRelayPopover();
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

const closeSettings = (): void => {
  if (!settingsView?.isOpen()) return;
  settingsView.close();
  settingsTrigger?.setAttribute("aria-expanded", "false");
};

const openSettings = (): void => {
  if (!settingsView) return;
  closeAccountMenu();
  closeSpotlight();
  closeRelayPopover();
  settingsTrigger?.setAttribute("aria-expanded", "true");
  settingsView.open();
};

const closeMenus = (): void => {
  closeAccountMenu();
  closeSpotlight();
  closeSettings();
  signedEventsView?.close();
  closeRelayPopover();
};

window.addEventListener("pagehide", () => signedEventsView?.destroy(), { once: true });

profileTrigger?.addEventListener("click", () => {
  if (!accountOpen) openAccountMenu();
  else closeAccountMenu();
});

relayStatus?.addEventListener("click", () => relayPopoverOpen ? closeRelayPopover() : openRelayPopover());

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
    const returnFocus = settingsView?.isOpen() ? settingsTrigger
      : spotlightPanel?.hidden === false ? spotlightTrigger
        : signedEventsPanel?.hidden === false ? signedEventsTrigger
          : relayPopoverOpen ? relayStatus
          : profileTrigger;
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
  if (relayPopover?.contains(target) || relayStatus?.contains(target)) return;
  if (signedEventsPanel?.contains(target) || signedEventsTrigger?.contains(target) || signedEventDialog?.contains(target)) return;
  if (settingsPanel?.contains(target) || settingsTrigger?.contains(target)) return;
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

const animateDockOpening = (button: HTMLButtonElement): (() => void) => {
  const icon = button.firstElementChild;
  button.setAttribute("aria-busy", "true");
  if (!(icon instanceof HTMLElement) || reducedMotion.matches) {
    return () => button.removeAttribute("aria-busy");
  }
  const timeline = gsap.timeline({ repeat: -1, repeatDelay: .08 });
  timeline
    .to(icon, { y: -18, scaleX: .94, scaleY: 1.06, duration: .2, ease: "power2.out" })
    .to(icon, { y: 0, scaleX: 1.05, scaleY: .95, duration: .24, ease: "power2.in" })
    .to(icon, { scaleX: 1, scaleY: 1, duration: .12, ease: "power2.out" });
  return () => {
    timeline.kill();
    gsap.set(icon, { clearProps: "transform" });
    button.removeAttribute("aria-busy");
  };
};

const clearDockHide = (): void => {
  if (dockHideTimer !== undefined) window.clearTimeout(dockHideTimer);
  dockHideTimer = undefined;
};

const setDockVisible = (visible: boolean, immediate = false): void => {
  if (!dockShell || coarsePointer.matches) return;
  clearDockHide();
  dockShell.dataset.visible = String(visible);
  dockShell.inert = !visible;
  gsap.killTweensOf(dockShell);
  const target = { y: visible ? 0 : 88, autoAlpha: visible ? 1 : 0 };
  if (immediate || reducedMotion.matches) {
    gsap.set(dockShell, target);
    return;
  }
  gsap.to(dockShell, { ...target, duration: visible ? .42 : .28, ease: visible ? "power4.out" : "power3.in" });
};

const scheduleDockHide = (delay = 500): void => {
  if (coarsePointer.matches || dockShell?.matches(":hover") || dockShell?.contains(document.activeElement)) return;
  clearDockHide();
  dockHideTimer = window.setTimeout(() => setDockVisible(false), delay);
};

const introduceDock = (): void => {
  if (!dockShell || coarsePointer.matches) return;
  setDockVisible(true, true);
  window.setTimeout(() => scheduleDockHide(0), 2_200);
};

const wireDockMotion = (): void => {
  if (!dockShell || !dock) return;
  const resetButtons = (): void => {
    gsap.to(dock.querySelectorAll(".dock-launcher"), { x: 0, y: 0, scale: 1, duration: .28, ease: "power3.out", overwrite: true });
  };
  dock.addEventListener("pointermove", (event) => {
    if (reducedMotion.matches || event.pointerType !== "mouse") return;
    const minimum = 52;
    const maximum = 84;
    const bound = minimum * Math.PI;
    dock.querySelectorAll<HTMLButtonElement>(".dock-launcher").forEach((button) => {
      const rect = button.getBoundingClientRect();
      const distance = rect.left + rect.width / 2 - event.clientX;
      let x = 0;
      let scale = 1;
      if (-bound < distance && distance < bound) {
        const radians = distance / minimum * .5;
        scale = 1 + (maximum / minimum - 1) * Math.cos(radians);
        x = 2 * (maximum - minimum) * Math.sin(radians);
      } else {
        x = (-bound < distance ? 2 : -2) * (maximum - minimum);
      }
      gsap.to(button, { x, y: -(scale - 1) * 20, scale, duration: .22, ease: "power3.out", overwrite: true });
    });
  });
  dock.addEventListener("pointerenter", () => { clearDockHide(); setDockVisible(true); });
  dock.addEventListener("pointerleave", () => { resetButtons(); scheduleDockHide(); });
  dock.addEventListener("focusin", () => setDockVisible(true));
  dock.addEventListener("focusout", () => scheduleDockHide(700));
  document.addEventListener("mousemove", (event) => {
    if (event.clientY >= window.innerHeight - 96) setDockVisible(true);
    else if (event.clientY < window.innerHeight - 112) scheduleDockHide(280);
  });
  if (coarsePointer.matches) {
    dockShell.dataset.visible = "true";
    dockShell.inert = false;
    gsap.set(dockShell, { y: 0, autoAlpha: 1 });
  }
};

wireDockMotion();

void bootstrap().then(async (platform) => {
  const nappletConsoleView = consoleTrigger && consolePanel && consoleHeader && consoleClose && consoleClear && consoleTabs && consoleOutput && consoleEmpty
    ? createNappletConsoleView({ trigger: consoleTrigger, panel: consolePanel, header: consoleHeader, close: consoleClose, clear: consoleClear, tabs: consoleTabs, output: consoleOutput, empty: consoleEmpty }, platform.windows, platform.nappletConsole, reducedMotion)
    : null;
  introduceDock();

  createThemeController({ settings: platform.settings, publishTheme: platform.publishTheme });
  if (settingsPanel && settingsTabs && settingsBody && settingsStatus) {
    settingsView = createSettingsView({
      panel: settingsPanel, tabs: settingsTabs, body: settingsBody, status: settingsStatus, platform, reducedMotion
    });
    settingsTrigger?.addEventListener("click", () => { if (settingsView?.isOpen()) closeSettings(); else openSettings(); });
    settingsClose?.addEventListener("click", () => { closeSettings(); settingsTrigger?.focus(); });
  }

  if (import.meta.env.VITE_INSTALL_FIXTURE === "true") {
    Object.defineProperty(window, "__platformTest", { value: platform, configurable: true });
  }
  if (button) button.disabled = false;

  const renderIdentity = (pubkey: string | undefined, profile: { name?: string | undefined; displayName?: string | undefined; picture?: string | undefined } | undefined): void => {
    if (accountStatus) accountStatus.textContent = pubkey ? `Active: ${pubkey.slice(0, 12)}…${pubkey.slice(-8)}` : "No active identity";
    if (connectAccount) connectAccount.hidden = Boolean(pubkey);
    if (connectEphemeral) connectEphemeral.hidden = Boolean(pubkey);
    if (signOut) signOut.hidden = !pubkey;
    if (!pubkey) {
      if (profileLabel) profileLabel.textContent = "Not connected";
      if (profileFallback) profileFallback.textContent = "R";
      if (profileImage) { profileImage.hidden = true; profileImage.removeAttribute("src"); }
      return;
    }
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
  // The pubkey and the profile arrive independently, so the pair is combined rather than
  // sequenced. This replaces a render-token guard that existed only to discard a stale profile.
  const identitySubscription = combineLatest([activePubkey$, activeProfile$])
    .subscribe(([pubkey, profile]) => renderIdentity(pubkey, profile));
  window.addEventListener("pagehide", () => identitySubscription.unsubscribe(), { once: true });
  if (connectAccount) connectAccount.disabled = false;
  if (connectEphemeral) connectEphemeral.disabled = false;
  connectAccount?.addEventListener("click", () => {
    connectAccount.disabled = true;
    if (accountStatus) accountStatus.textContent = "Waiting for Nostr extension…";
    void platform.connectExtension()
      .catch((error: unknown) => {
        if (accountStatus) accountStatus.textContent = error instanceof Error ? error.message : "Unable to connect Nostr extension";
      })
      .finally(() => { connectAccount.disabled = false; });
  });
  connectEphemeral?.addEventListener("click", () => {
    connectEphemeral.disabled = true;
    if (accountStatus) accountStatus.textContent = "Creating ephemeral identity…";
    void platform.connectEphemeral()
      .catch((error: unknown) => {
        if (accountStatus) accountStatus.textContent = error instanceof Error ? error.message : "Unable to create ephemeral identity";
      })
      .finally(() => { connectEphemeral.disabled = false; });
  });
  signOut?.addEventListener("click", () => { platform.signOut(); closeMenus(); });

  const windowSessions = createWindowSessionStore(localStorage);
  const initialSession = windowSessions.get();
  const dockStore = createDockStore(localStorage);
  const dockIconStore = await openDockIconStore();
  const iconOverrides = new Map<string, DockIconOverride>();
  const dockMenu = document.createElement("div");
  const dockMenuIconAction = document.createElement("button");
  const dockMenuResetAction = document.createElement("button");
  const dockMenuPinAction = document.createElement("button");
  const iconEditor = document.createElement("section");
  const iconEditorTitle = document.createElement("h2");
  const iconEditorPreview = document.createElement("div");
  const iconEditorLetter = document.createElement("input");
  const iconEditorUseLetter = document.createElement("button");
  const iconEditorUpload = document.createElement("button");
  const iconEditorReset = document.createElement("button");
  const iconEditorCancel = document.createElement("button");
  const iconEditorFile = document.createElement("input");
  const iconEditorStatus = document.createElement("p");
  let dockMenuLauncher: DockLauncher | undefined;
  let dockMenuAnchor: HTMLButtonElement | undefined;
  let iconEditorLauncher: DockLauncher | undefined;
  let iconEditorAnchor: HTMLButtonElement | undefined;
  dockMenu.className = "dock-context-menu";
  dockMenu.hidden = true;
  dockMenu.setAttribute("role", "menu");
  for (const action of [dockMenuIconAction, dockMenuResetAction, dockMenuPinAction]) {
    action.type = "button";
    action.setAttribute("role", "menuitem");
  }
  dockMenuIconAction.textContent = "Change Icon…";
  dockMenuResetAction.textContent = "Reset to Napplet Icon";
  dockMenu.append(dockMenuIconAction, dockMenuResetAction, dockMenuPinAction);

  iconEditor.className = "dock-icon-editor";
  iconEditor.hidden = true;
  iconEditor.setAttribute("role", "dialog");
  iconEditor.setAttribute("aria-modal", "false");
  iconEditorTitle.id = "dock-icon-editor-title";
  iconEditor.setAttribute("aria-labelledby", iconEditorTitle.id);
  iconEditorPreview.className = "dock-icon-editor-preview";
  iconEditorLetter.className = "dock-icon-letter-input";
  iconEditorLetter.maxLength = 2;
  iconEditorLetter.autocomplete = "off";
  iconEditorLetter.spellcheck = false;
  iconEditorLetter.setAttribute("aria-label", "Icon letters");
  iconEditorUseLetter.type = "button";
  iconEditorUseLetter.textContent = "Use Letters";
  iconEditorUpload.type = "button";
  iconEditorUpload.textContent = "Upload Image";
  iconEditorReset.type = "button";
  iconEditorReset.textContent = "Use Napplet Icon";
  iconEditorCancel.type = "button";
  iconEditorCancel.textContent = "Cancel";
  iconEditorFile.type = "file";
  iconEditorFile.accept = "image/png,image/jpeg,image/webp,image/avif";
  iconEditorFile.hidden = true;
  iconEditorStatus.className = "dock-icon-editor-status";
  iconEditorStatus.setAttribute("role", "status");
  const iconEditorActions = document.createElement("div");
  iconEditorActions.className = "dock-icon-editor-actions";
  iconEditorActions.append(iconEditorUseLetter, iconEditorUpload, iconEditorReset, iconEditorCancel);
  iconEditor.append(iconEditorTitle, iconEditorPreview, iconEditorLetter, iconEditorActions, iconEditorFile, iconEditorStatus);
  document.body.append(dockMenu, iconEditor);

  const createDockIcon = (launcher: DockLauncher, override = iconOverrides.get(launcher.coordinate)): HTMLImageElement | HTMLSpanElement => {
    const imageUrl = override?.type === "image" ? override.dataUrl : override ? undefined : launcher.iconUrl;
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.decoding = "async";
      return image;
    }
    const initial = document.createElement("span");
    initial.className = "dock-initial";
    initial.textContent = override?.type === "letter" ? override.value : launcher.initial;
    initial.setAttribute("aria-hidden", "true");
    return initial;
  };

  const renderIconEditorPreview = (): void => {
    const launcher = iconEditorLauncher;
    if (!launcher) return;
    iconEditorPreview.replaceChildren(createDockIcon(launcher));
  };

  const closeIconEditor = (restoreFocus = false): void => {
    if (iconEditor.hidden) return;
    gsap.killTweensOf(iconEditor);
    iconEditor.hidden = true;
    iconEditorLauncher = undefined;
    iconEditorStatus.textContent = "";
    iconEditorFile.value = "";
    if (restoreFocus) iconEditorAnchor?.focus();
    iconEditorAnchor = undefined;
  };

  const closeDockMenu = (restoreFocus = false): void => {
    if (dockMenu.hidden) return;
    gsap.killTweensOf(dockMenu);
    dockMenu.hidden = true;
    dockMenuLauncher = undefined;
    if (dockMenuAnchor) delete dockMenuAnchor.dataset.contextOpen;
    if (restoreFocus) dockMenuAnchor?.focus();
    dockMenuAnchor = undefined;
  };

  const openDockMenu = (launcher: DockLauncher, anchor: HTMLButtonElement, clientX?: number, clientY?: number): void => {
    if (dockMenuAnchor && dockMenuAnchor !== anchor) delete dockMenuAnchor.dataset.contextOpen;
    dockMenuLauncher = launcher;
    dockMenuAnchor = anchor;
    anchor.dataset.contextOpen = "true";
    const pinned = dockStore.has(launcher.coordinate);
    dockMenuIconAction.setAttribute("aria-label", `Change ${launcher.title} icon`);
    dockMenuResetAction.hidden = !iconOverrides.has(launcher.coordinate);
    dockMenuResetAction.setAttribute("aria-label", `Reset ${launcher.title} to Napplet icon`);
    dockMenuPinAction.disabled = launcher.builtIn === true;
    dockMenuPinAction.textContent = launcher.builtIn ? "Built in to Rocketshell" : pinned ? "Remove from Dock" : "Keep in Dock";
    dockMenuPinAction.setAttribute("aria-label", launcher.builtIn
      ? `${launcher.title} is built in to Rocketshell`
      : `${pinned ? "Remove" : "Keep"} ${launcher.title} ${pinned ? "from" : "in"} Dock`);
    dockMenu.hidden = false;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = dockMenu.getBoundingClientRect();
    const preferredX = clientX && clientX > 0 ? clientX : anchorRect.left + anchorRect.width / 2;
    const preferredY = clientY && clientY > 0 ? clientY : anchorRect.top;
    dockMenu.style.left = `${Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, preferredX - menuRect.width / 2))}px`;
    dockMenu.style.top = `${Math.max(8, preferredY - menuRect.height - 10)}px`;
    if (reducedMotion.matches) gsap.set(dockMenu, { autoAlpha: 1, scale: 1, y: 0 });
    else gsap.fromTo(dockMenu, { autoAlpha: 0, scale: .94, y: 6 }, { autoAlpha: 1, scale: 1, y: 0, duration: .22, ease: "expo.out" });
    dockMenuIconAction.focus();
  };

  dockMenuPinAction.addEventListener("click", () => {
    const launcher = dockMenuLauncher;
    if (!launcher || launcher.builtIn) return;
    if (dockStore.has(launcher.coordinate)) dockStore.unpin(launcher.coordinate);
    else dockStore.pin(launcher.coordinate);
    closeDockMenu(true);
    void renderDock();
  });
  dockMenuIconAction.addEventListener("click", () => {
    const launcher = dockMenuLauncher;
    if (!launcher) return;
    iconEditorAnchor = dockMenuAnchor;
    closeDockMenu();
    iconEditorLauncher = launcher;
    iconEditorTitle.textContent = `Change ${launcher.title} icon`;
    const override = iconOverrides.get(launcher.coordinate);
    iconEditorLetter.value = override?.type === "letter" ? override.value : launcher.initial;
    renderIconEditorPreview();
    iconEditor.hidden = false;
    if (reducedMotion.matches) gsap.set(iconEditor, { autoAlpha: 1, scale: 1, y: 0 });
    else gsap.fromTo(iconEditor, { autoAlpha: 0, scale: .96, y: 8 }, { autoAlpha: 1, scale: 1, y: 0, duration: .24, ease: "expo.out" });
    iconEditorLetter.focus();
    iconEditorLetter.select();
  });
  dockMenuResetAction.addEventListener("click", () => {
    const launcher = dockMenuLauncher;
    if (!launcher) return;
    void dockIconStore.delete(launcher.coordinate).then(() => {
      iconOverrides.delete(launcher.coordinate);
      closeDockMenu(true);
      void renderDock();
    }).catch(() => {
      dockMenuResetAction.textContent = "Unable to reset icon";
    });
  });
  const saveIconOverride = async (override: DockIconOverride): Promise<void> => {
    const launcher = iconEditorLauncher;
    if (!launcher) return;
    await dockIconStore.set(launcher.coordinate, override);
    iconOverrides.set(launcher.coordinate, override);
    await renderDock();
    closeIconEditor(true);
  };
  iconEditorUseLetter.addEventListener("click", () => {
    const value = Array.from(iconEditorLetter.value.trim()).slice(0, 2).join("").toLocaleUpperCase();
    if (!value) {
      iconEditorStatus.textContent = "Enter one or two characters.";
      iconEditorLetter.focus();
      return;
    }
    iconEditorStatus.textContent = "Saving icon…";
    void saveIconOverride({ type: "letter", value }).catch(() => { iconEditorStatus.textContent = "Unable to save icon."; });
  });
  iconEditorUpload.addEventListener("click", () => iconEditorFile.click());
  iconEditorFile.addEventListener("change", () => {
    const file = iconEditorFile.files?.[0];
    if (!file) return;
    void (async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
      iconEditorStatus.textContent = "Preparing image…";
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width < 1 || bitmap.height < 1) throw new Error("Image has no visible pixels.");
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image editor unavailable.");
        const scale = Math.max(256 / bitmap.width, 256 / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.drawImage(bitmap, (256 - width) / 2, (256 - height) / 2, width, height);
        const dataUrl = canvas.toDataURL("image/webp", .9);
        await saveIconOverride({ type: "image", dataUrl });
      } finally {
        bitmap.close();
      }
    })().catch((error: unknown) => {
      iconEditorStatus.textContent = error instanceof Error ? error.message : "Unable to use that image.";
      iconEditorFile.value = "";
    });
  });
  iconEditorReset.addEventListener("click", () => {
    const launcher = iconEditorLauncher;
    if (!launcher) return;
    iconEditorStatus.textContent = "Restoring Napplet icon…";
    void dockIconStore.delete(launcher.coordinate).then(async () => {
      iconOverrides.delete(launcher.coordinate);
      await renderDock();
      closeIconEditor(true);
    }).catch(() => { iconEditorStatus.textContent = "Unable to restore icon."; });
  });
  iconEditorCancel.addEventListener("click", () => closeIconEditor(true));
  document.addEventListener("pointerdown", (event) => {
    if (!dockMenu.hidden && !dockMenu.contains(event.target as Node) && !dockMenuAnchor?.contains(event.target as Node)) closeDockMenu();
    if (!iconEditor.hidden && !iconEditor.contains(event.target as Node) && !iconEditorAnchor?.contains(event.target as Node)) closeIconEditor();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!iconEditor.hidden) { event.preventDefault(); closeIconEditor(true); }
    else if (!dockMenu.hidden) { event.preventDefault(); closeDockMenu(true); }
  });
  window.addEventListener("resize", () => { closeDockMenu(); closeIconEditor(); });
  window.addEventListener("scroll", () => { closeDockMenu(); closeIconEditor(); }, true);

  windowsContainer?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const closeButton = target.closest<HTMLButtonElement>(".napplet-window-close");
    const windowId = closeButton?.dataset.windowId;
    if (!windowId) return;
    void renderDock();
  });

  const openCoordinate = async (requestedCoordinate?: string, installedDTag?: string): Promise<void> => {
    if (!input || !button) return;
    const coordinate = (requestedCoordinate ?? input.value).trim();
    if (!coordinate) return;
    button.disabled = true;
    button.textContent = "Opening…";
    input.setAttribute("aria-invalid", "false");
    setLoaderStatus(installedDTag ? "Opening verified package…" : "Resolving signed manifest and verifying package…", "busy");
    animateLoading();
    try {
      const opened = installedDTag
        ? await platform.openInstalled(installedDTag)
        : await platform.installAndOpen(coordinate);
      platform.windows.setLaunchDescriptor(opened.windowId, { type: "direct", coordinate });
      void renderDock();
      if (!requestedCoordinate || input.value.trim() === coordinate) input.value = "";
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

  const renderDock = async (): Promise<void> => {
    if (!dockItems || !dock || !dockStatus) return;
    const available = await platform.dockLaunchers();
    await Promise.all(available.map(async (launcher) => {
      const override = await dockIconStore.get(launcher.coordinate);
      if (override) iconOverrides.set(launcher.coordinate, override);
      else iconOverrides.delete(launcher.coordinate);
    }));
    const pinned = dockStore.get();
    const openDTags = new Set(platform.windows.listWindowIds().flatMap((windowId) => {
      const managed = platform.windows.findByWindowId(windowId);
      return managed ? [managed.identity.dTag] : [];
    }));
    const launcherByCoordinate = new Map(available.map((launcher) => [launcher.coordinate, launcher]));
    const builtInCoordinates = new Set(available.filter((launcher) => launcher.builtIn).map((launcher) => launcher.coordinate));
    const launchers = [
      ...available.filter((launcher) => launcher.builtIn),
      ...pinned.flatMap((coordinate) => {
        const launcher = launcherByCoordinate.get(coordinate);
        return launcher && !launcher.builtIn ? [launcher] : [];
      }),
      ...available.filter((launcher) => openDTags.has(launcher.dTag)
        && !builtInCoordinates.has(launcher.coordinate)
        && !pinned.includes(launcher.coordinate))
    ];
    dockItems.replaceChildren();
    const buttons = launchers.map((launcher) => {
      const item = document.createElement("li");
      const dockButton = document.createElement("button");
      const icon = createDockIcon(launcher);
      const label = document.createElement("span");
      const running = document.createElement("span");
      dockButton.type = "button";
      dockButton.className = "dock-launcher";
      dockButton.title = launcher.title;
      dockButton.setAttribute("aria-label", `Open ${launcher.title}`);
      label.className = "dock-label";
      label.textContent = launcher.title;
      running.className = "dock-running-indicator";
      running.hidden = !openDTags.has(launcher.dTag);
      running.setAttribute("aria-hidden", "true");
      dockButton.append(icon, label, running);
      item.append(dockButton);
      dockItems.append(item);
      let longPressed = false;
      let longPressTimer: number | undefined;
      const cancelLongPress = (): void => {
        if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      };
      dockButton.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        cancelLongPress();
        longPressTimer = window.setTimeout(() => {
          longPressed = true;
          openDockMenu(launcher, dockButton, event.clientX, event.clientY);
        }, 550);
      });
      dockButton.addEventListener("pointerup", cancelLongPress);
      dockButton.addEventListener("pointercancel", cancelLongPress);
      dockButton.addEventListener("pointermove", cancelLongPress);
      dockButton.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        cancelLongPress();
        openDockMenu(launcher, dockButton, event.clientX, event.clientY);
      });
      dockButton.addEventListener("click", () => {
        if (longPressed) { longPressed = false; return; }
        dockButton.disabled = true;
        const stopOpeningAnimation = animateDockOpening(dockButton);
        void openCoordinate(launcher.coordinate, launcher.dTag).finally(() => {
          stopOpeningAnimation();
          dockButton.disabled = false;
        });
      });
      return dockButton;
    });
    dockStatus.hidden = launchers.length > 0;
    dockStatus.textContent = launchers.length > 0 ? "" : "Open a napplet to add it to the Dock.";
    dock.hidden = launchers.length === 0;
    if (!reducedMotion.matches && buttons.length > 0) {
      gsap.fromTo(buttons, { y: 20, scale: .72, autoAlpha: 0 }, {
        y: 0, scale: 1, autoAlpha: 1, duration: .5, stagger: .045, ease: "back.out(1.8)", clearProps: "opacity,visibility"
      });
    }
  };

  let restoringSession = true;
  const currentSession = (): WindowSession => {
    const windows = platform.windows.listWindowIds().flatMap((windowId) => {
      const managed = platform.windows.findByWindowId(windowId);
      if (!managed?.launch) return [];
      const replacesWindowId = managed.replacesWindowId;
      const replaced = replacesWindowId ? platform.windows.findByWindowId(replacesWindowId) : undefined;
      return [{
        windowId, dTag: managed.identity.dTag, launch: managed.launch, hidden: managed.element.hidden,
        ...(replacesWindowId && replaced?.element.hidden ? { replacesWindowId } : {})
      }];
    });
    const focusedWindowId = platform.windows.focusedWindowId;
    return {
      version: 2, windows,
      ...(focusedWindowId && windows.some((window) => window.windowId === focusedWindowId) ? { focusedWindowId } : {})
    };
  };
  const unsubscribeWindows = platform.windows.onWindowsChanged(() => {
    void renderDock();
    if (!restoringSession) windowSessions.set(currentSession());
  });
  window.addEventListener("pagehide", () => { unsubscribeWindows(); nappletConsoleView?.close(); dockIconStore.close(); }, { once: true });
  void renderDock();

  form?.addEventListener("submit", (event) => { event.preventDefault(); void openCoordinate(); });
  platformLoadingTween?.kill();
  document.removeEventListener("visibilitychange", syncPlatformLoader);
  if (status) status.hidden = true;
  void (async () => {
    const restoredIds = new Map<string, string>();
    const launchers = await platform.dockLaunchers();
    for (const saved of initialSession.windows) {
      try {
        const launch = saved.launch;
        const dTag = saved.dTag ?? (launch.type === "direct"
          ? launchers.find((launcher) => launcher.coordinate === launch.coordinate)?.dTag
          : undefined);
        if (!dTag) throw new Error("Saved Napplet is no longer installed");
        const opened = await platform.openInstalled(dTag);
        restoredIds.set(saved.windowId, opened.windowId);
        platform.windows.setLaunchDescriptor(opened.windowId, saved.launch);
        const managed = platform.windows.findByWindowId(opened.windowId);
        if (saved.launch.type === "intent" && managed) {
          await managed.ready;
          managed.identity.source.postMessage({
            type: "inc.event", topic: saved.launch.convention, sender: saved.launch.sender,
            ...(saved.launch.payload === undefined ? {} : { payload: saved.launch.payload })
          }, "*");
        }
      } catch (error) {
        console.error("Unable to restore saved Napplet window", { dTag: saved.dTag, error });
      }
    }
    for (const saved of initialSession.windows) {
      const targetId = restoredIds.get(saved.windowId);
      const callerId = saved.replacesWindowId ? restoredIds.get(saved.replacesWindowId) : undefined;
      if (targetId && callerId) platform.windows.focus(targetId, callerId);
    }
    for (const saved of initialSession.windows) {
      const restoredId = restoredIds.get(saved.windowId);
      const managed = restoredId ? platform.windows.findByWindowId(restoredId) : undefined;
      if (managed) managed.element.hidden = saved.hidden;
    }
    const focusedId = initialSession.focusedWindowId ? restoredIds.get(initialSession.focusedWindowId) : undefined;
    if (focusedId) platform.windows.findByWindowId(focusedId)?.iframe.focus();
  })().catch((error: unknown) => {
    console.error("Unable to restore saved Napplet session", error);
  }).finally(() => {
    restoringSession = false;
    windowSessions.set(currentSession());
  });
}).catch((error: unknown) => {
  if (status) status.textContent = `Startup failed: ${error instanceof Error ? error.message : "unknown error"}`;
});

window.addEventListener("pagehide", () => widgetGrid?.destroy(), { once: true });
