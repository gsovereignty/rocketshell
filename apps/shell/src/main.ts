import { combineLatest } from "rxjs";
import { bootstrap } from "./bootstrap.js";
import { createShellSettingsStore } from "@platform/host-services";
import { connectedRelayCount$, connectedRelays$ } from "@platform/nostr-engine";
import { activePubkey$, activeProfile$, getSeenRelaysForEvent, signedEvents$ } from "./nostr.js";
import { gsap } from "gsap";
import { DEFAULT_SHELL_SETTINGS } from "./platform.js";
import { createSettingsView, createThemeController, resolveTheme, type SettingsView } from "./settings-view.js";
import { createWidgetGrid } from "./widget-layout.js";
import { activateOpenWindow } from "./menu-window-activation.js";
import { createWindowSessionStore, type WindowSession } from "./open-napplets-store.js";
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
const dagViewerTrigger = document.querySelector<HTMLButtonElement>("#dag-viewer-trigger");
const newRocketTrigger = document.querySelector<HTMLButtonElement>("#new-rocket-trigger");
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

void bootstrap().then(async (platform) => {
  const nappletConsoleView = consoleTrigger && consolePanel && consoleHeader && consoleClose && consoleClear && consoleTabs && consoleOutput && consoleEmpty
    ? createNappletConsoleView({ trigger: consoleTrigger, panel: consolePanel, header: consoleHeader, close: consoleClose, clear: consoleClear, tabs: consoleTabs, output: consoleOutput, empty: consoleEmpty }, platform.windows, platform.nappletConsole, reducedMotion)
    : null;
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

  const openMenuLauncher = async (launcher: { readonly coordinate: string; readonly dTag: string; readonly title: string }): Promise<void> => {
    const existing = activateOpenWindow(platform.windows, widgetGrid, launcher.dTag);
    if (existing) {
      const title = existing.element.querySelector<HTMLElement>(".napplet-window-title")?.textContent?.trim() || launcher.title;
      setLoaderStatus(`Focused ${title}.`, "success");
      return;
    }
    await openCoordinate(launcher.coordinate, launcher.dTag);
  };

  dagViewerTrigger?.addEventListener("click", () => {
    dagViewerTrigger.disabled = true;
    dagViewerTrigger.setAttribute("aria-busy", "true");
    void platform.dockLaunchers().then(async (launchers) => {
      const launcher = launchers.find(({ dTag }) => dTag === "navigate-problem-tree");
      if (!launcher) throw new Error("DAG viewer is not installed");
      await openMenuLauncher(launcher);
    }).catch((error: unknown) => {
      console.error("Opening DAG viewer from menu bar failed", { dTag: "navigate-problem-tree", error });
      setLoaderStatus(error instanceof Error ? error.message : "Unable to open DAG viewer", "error");
    }).finally(() => {
      dagViewerTrigger.disabled = false;
      dagViewerTrigger.removeAttribute("aria-busy");
    });
  });

  newRocketTrigger?.addEventListener("click", () => {
    newRocketTrigger.disabled = true;
    newRocketTrigger.setAttribute("aria-busy", "true");
    void platform.dockLaunchers().then(async (launchers) => {
      const launcher = launchers.find(({ dTag }) => dTag === "create-rocket");
      if (!launcher) throw new Error("Rocket creator is not installed");
      await openMenuLauncher(launcher);
    }).catch((error: unknown) => {
      console.error("Opening Rocket creator from menu bar failed", { dTag: "create-rocket", error });
      setLoaderStatus(error instanceof Error ? error.message : "Unable to open Rocket creator", "error");
    }).finally(() => {
      newRocketTrigger.disabled = false;
      newRocketTrigger.removeAttribute("aria-busy");
    });
  });


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
    if (!restoringSession) windowSessions.set(currentSession());
  });
  window.addEventListener("pagehide", () => { unsubscribeWindows(); nappletConsoleView?.close(); }, { once: true });

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
