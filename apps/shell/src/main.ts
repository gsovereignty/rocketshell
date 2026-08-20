import { combineLatest } from "rxjs";
import { bootstrap } from "./bootstrap.js";
import { createShellSettingsStore } from "@platform/host-services";
import { activePubkey$, activeProfile$ } from "./nostr.js";
import { gsap } from "gsap";
import { DEFAULT_SHELL_SETTINGS } from "./platform.js";
import { createSettingsView, createThemeController, resolveTheme, type SettingsView } from "./settings-view.js";
import { createWidgetGrid } from "./widget-layout.js";
import { createOpenNappletsStore } from "./open-napplets-store.js";
import { createDockStore } from "./dock-store.js";
import type { DockLauncher } from "./dock-launchers.js";
import "./style.css";

// Paint the stored theme before the asynchronous platform boot, otherwise a light-theme user gets a
// flash of the dark palette while IndexedDB and the service worker come up.
document.documentElement.setAttribute("data-theme", resolveTheme(
  createShellSettingsStore(localStorage, DEFAULT_SHELL_SETTINGS).get().theme,
  window.matchMedia("(prefers-color-scheme: dark)").matches
));

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
const settingsTrigger = document.querySelector<HTMLButtonElement>("#settings-trigger");
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const settingsTabs = document.querySelector<HTMLElement>("#settings-tabs");
const settingsBody = document.querySelector<HTMLElement>("#settings-body");
const settingsStatus = document.querySelector<HTMLElement>("#settings-status");
const settingsClose = document.querySelector<HTMLButtonElement>("#settings-close");
const windowsContainer = document.querySelector<HTMLElement>("#windows");
const dockShell = document.querySelector<HTMLElement>("#dock-shell");
const dock = document.querySelector<HTMLElement>("#napplet-dock");
const dockItems = document.querySelector<HTMLUListElement>("#dock-items");
const dockStatus = document.querySelector<HTMLElement>("#dock-status");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = window.matchMedia("(hover: none)");
const widgetGrid = windowsContainer ? createWidgetGrid(windowsContainer, reducedMotion) : null;
let loadingTimeline: gsap.core.Timeline | null = null;
let accountTimeline: gsap.core.Timeline | null = null;
let accountOpen = false;
let settingsView: SettingsView | null = null;
let dockHideTimer: number | undefined;

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

const closeSettings = (): void => {
  if (!settingsView?.isOpen()) return;
  settingsView.close();
  settingsTrigger?.setAttribute("aria-expanded", "false");
};

const openSettings = (): void => {
  if (!settingsView) return;
  closeAccountMenu();
  closeSpotlight();
  settingsTrigger?.setAttribute("aria-expanded", "true");
  settingsView.open();
};

const closeMenus = (): void => {
  closeAccountMenu();
  closeSpotlight();
  closeSettings();
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
    const returnFocus = settingsView?.isOpen() ? settingsTrigger : spotlightPanel?.hidden === false ? spotlightTrigger : profileTrigger;
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
    if (event.clientY >= window.innerHeight - 40) setDockVisible(true);
    else if (event.clientY < window.innerHeight - 112) scheduleDockHide(280);
  });
  if (coarsePointer.matches) {
    dockShell.dataset.visible = "true";
    dockShell.inert = false;
    gsap.set(dockShell, { y: 0, autoAlpha: 1 });
  }
};

wireDockMotion();

void bootstrap().then((platform) => {
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
    if (signOut) signOut.hidden = !pubkey;
    if (!pubkey) {
      if (profileLabel) profileLabel.textContent = "Not connected";
      if (profileFallback) profileFallback.textContent = "K";
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
  connectAccount?.addEventListener("click", () => {
    connectAccount.disabled = true;
    if (accountStatus) accountStatus.textContent = "Waiting for Nostr extension…";
    void platform.connectExtension()
      .catch((error: unknown) => {
        if (accountStatus) accountStatus.textContent = error instanceof Error ? error.message : "Unable to connect Nostr extension";
      })
      .finally(() => { connectAccount.disabled = false; });
  });
  signOut?.addEventListener("click", () => { platform.signOut(); closeMenus(); });

  const openedCoordinates = new Map<string, { coordinate: string; dTag: string }>();
  const openNapplets = createOpenNappletsStore(localStorage);
  const dockStore = createDockStore(localStorage);
  const dockMenu = document.createElement("div");
  const dockMenuAction = document.createElement("button");
  let dockMenuLauncher: DockLauncher | undefined;
  let dockMenuAnchor: HTMLButtonElement | undefined;
  dockMenu.className = "dock-context-menu";
  dockMenu.hidden = true;
  dockMenu.setAttribute("role", "menu");
  dockMenuAction.type = "button";
  dockMenuAction.setAttribute("role", "menuitem");
  dockMenu.append(dockMenuAction);
  document.body.append(dockMenu);

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
    dockMenuAction.textContent = pinned ? "Remove from Dock" : "Keep in Dock";
    dockMenuAction.setAttribute("aria-label", `${pinned ? "Remove" : "Keep"} ${launcher.title} ${pinned ? "from" : "in"} Dock`);
    dockMenu.hidden = false;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = dockMenu.getBoundingClientRect();
    const preferredX = clientX && clientX > 0 ? clientX : anchorRect.left + anchorRect.width / 2;
    const preferredY = clientY && clientY > 0 ? clientY : anchorRect.top;
    dockMenu.style.left = `${Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, preferredX - menuRect.width / 2))}px`;
    dockMenu.style.top = `${Math.max(8, preferredY - menuRect.height - 10)}px`;
    if (reducedMotion.matches) gsap.set(dockMenu, { autoAlpha: 1, scale: 1, y: 0 });
    else gsap.fromTo(dockMenu, { autoAlpha: 0, scale: .94, y: 6 }, { autoAlpha: 1, scale: 1, y: 0, duration: .22, ease: "expo.out" });
    dockMenuAction.focus();
  };

  dockMenuAction.addEventListener("click", () => {
    const launcher = dockMenuLauncher;
    if (!launcher) return;
    if (dockStore.has(launcher.coordinate)) dockStore.unpin(launcher.coordinate);
    else dockStore.pin(launcher.coordinate);
    closeDockMenu(true);
    void renderDock();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!dockMenu.hidden && !dockMenu.contains(event.target as Node) && !dockMenuAnchor?.contains(event.target as Node)) closeDockMenu();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !dockMenu.hidden) { event.preventDefault(); closeDockMenu(true); } });
  window.addEventListener("resize", () => closeDockMenu());
  window.addEventListener("scroll", () => closeDockMenu(), true);

  windowsContainer?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const closeButton = target.closest<HTMLButtonElement>(".napplet-window-close");
    const windowId = closeButton?.dataset.windowId;
    const opened = windowId ? openedCoordinates.get(windowId) : undefined;
    if (!windowId) return;
    openedCoordinates.delete(windowId);
    if (opened) openNapplets.remove(opened.coordinate);
    void renderDock();
  });

  const openCoordinate = async (requestedCoordinate?: string, remember = true, installedDTag?: string): Promise<void> => {
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
      openedCoordinates.set(opened.windowId, { coordinate, dTag: opened.dTag });
      void renderDock();
      if (!requestedCoordinate || input.value.trim() === coordinate) input.value = "";
      if (remember) openNapplets.add(coordinate, opened.dTag);
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
    const pinned = dockStore.get();
    const openDTags = new Set(platform.windows.listWindowIds().flatMap((windowId) => {
      const managed = platform.windows.findByWindowId(windowId);
      return managed ? [managed.identity.dTag] : [];
    }));
    const launcherByCoordinate = new Map(available.map((launcher) => [launcher.coordinate, launcher]));
    const launchers = [
      ...pinned.flatMap((coordinate) => {
        const launcher = launcherByCoordinate.get(coordinate);
        return launcher ? [launcher] : [];
      }),
      ...available.filter((launcher) => openDTags.has(launcher.dTag) && !pinned.includes(launcher.coordinate))
    ];
    dockItems.replaceChildren();
    const buttons = launchers.map((launcher) => {
      const item = document.createElement("li");
      const dockButton = document.createElement("button");
      const icon = launcher.iconUrl ? document.createElement("img") : document.createElement("span");
      const label = document.createElement("span");
      const running = document.createElement("span");
      dockButton.type = "button";
      dockButton.className = "dock-launcher";
      dockButton.title = launcher.title;
      dockButton.setAttribute("aria-label", `Open ${launcher.title}`);
      if (icon instanceof HTMLImageElement) {
        icon.src = launcher.iconUrl!;
        icon.alt = "";
        icon.decoding = "async";
      } else {
        icon.className = "dock-initial";
        icon.textContent = launcher.initial;
        icon.setAttribute("aria-hidden", "true");
      }
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
        void openCoordinate(launcher.coordinate, true, launcher.dTag).finally(() => { dockButton.disabled = false; });
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

  const unsubscribeDock = platform.windows.onWindowsChanged(() => { void renderDock(); });
  window.addEventListener("pagehide", unsubscribeDock, { once: true });
  void renderDock();

  form?.addEventListener("submit", (event) => { event.preventDefault(); void openCoordinate(); });
  if (status) status.textContent = "Platform ready";
  const initialNapplets = openNapplets.get();
  if (initialNapplets.length > 0) {
    void (async () => {
      const launchers = await platform.dockLaunchers();
      for (const napplet of initialNapplets) {
        const dTag = napplet.dTag ?? launchers.find((launcher) => launcher.coordinate === napplet.coordinate)?.dTag;
        if (dTag && !napplet.dTag) openNapplets.identify(napplet.coordinate, dTag);
        await openCoordinate(napplet.coordinate, false, dTag);
      }
    })();
  }
}).catch((error: unknown) => {
  if (status) status.textContent = `Startup failed: ${error instanceof Error ? error.message : "unknown error"}`;
});

window.addEventListener("pagehide", () => widgetGrid?.destroy(), { once: true });
