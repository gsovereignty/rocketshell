import { combineLatest, map, type Observable, type Subscription } from "rxjs";
import { gsap } from "gsap";
import type { ShellSettings, ShellSettingsStore, ThemePreference } from "@platform/host-services";
import { activePubkey$, mailboxes$, normalizeMediaServer, normalizeRelay, ownBlossomServers$, relayLimit } from "./nostr.js";
import type { BrowserPlatform } from "./platform.js";

export type ResolvedTheme = "light" | "dark";
export type SettingsTab = "appearance" | "relays" | "media";

/** Which locally persisted list a section edits. */
type LocalListKey = "backupRelays" | "lookupRelays" | "backupBlossomServers";

export const THEME_OPTIONS: readonly { readonly id: ThemePreference; readonly label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" }
];

export const SETTINGS_TABS: readonly { readonly id: SettingsTab; readonly label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "relays", label: "Relays" },
  { id: "media", label: "Media servers" }
];

/** "system" follows the OS; an explicit choice always wins. */
export const resolveTheme = (preference: ThemePreference, prefersDark: boolean): ResolvedTheme =>
  preference === "system" ? (prefersDark ? "dark" : "light") : preference;

export type UrlCheck = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: string };

/**
 * Validates a URL typed into an add-form before anything is persisted or published: normalizes it,
 * rejects duplicates, and enforces the platform relay budget so the failure is an inline message
 * rather than a rejected publish or a silently discarded tier.
 */
export function checkUrl(raw: string, normalize: (url: string) => string, existing: readonly string[], limit?: number): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter an address first." };
  let url: string;
  try { url = normalize(trimmed); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "That address is not valid." }; }
  if (existing.includes(url)) return { ok: false, error: "That address is already in the list." };
  if (limit !== undefined && existing.length >= limit) return { ok: false, error: `This list is limited to ${limit} entries.` };
  return { ok: true, url };
}

const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "Something went wrong.";
  const known: Record<string, string> = {
    "signed-out": "Connect an identity first.",
    "list-not-published": "Nothing to change: this list has not been published yet.",
    "list-unavailable": "Could not load your current list, so it was left untouched.",
    "relay-lookup-failed": "Could not reach your relays, so your list was left untouched.",
    "no-relays-configured": "No relays are configured to read from.",
    "no-publish-relays": "No relays are configured to publish to.",
    "publish-rejected": "Every relay rejected the update.",
    "invalid-event": "The update was rejected as malformed."
  };
  return known[error.message] ?? error.message;
};

/** Only what the panel cannot reach on its own; the reactive Nostr state is imported directly. */
export type SettingsPlatform = Pick<BrowserPlatform, "settings" | "accountLists" | "publishTheme">;

export interface ThemeController {
  /** Re-resolves the preference and repaints the shell and every open napplet. */
  apply(): void;
  destroy(): void;
}

/**
 * Owns `data-theme` on the document. Split out from the panel because the theme must be applied on
 * boot, whether or not the user ever opens preferences.
 */
export function createThemeController(options: {
  readonly settings: ShellSettingsStore;
  readonly publishTheme?: (colors: { readonly background: string; readonly text: string; readonly primary: string }) => void;
  readonly root?: HTMLElement;
  readonly colorScheme?: MediaQueryList;
}): ThemeController {
  const root = options.root ?? document.documentElement;
  const colorScheme = options.colorScheme ?? window.matchMedia("(prefers-color-scheme: dark)");

  const apply = (): void => {
    const preference = options.settings.get().theme;
    root.setAttribute("data-theme", resolveTheme(preference, colorScheme.matches));
    if (!options.publishTheme) return;
    // Read the palette back out of CSS so napplets are themed with the same tokens as the shell.
    const styles = getComputedStyle(root);
    const token = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
    options.publishTheme({
      background: token("--bg", "#141413"),
      text: token("--text", "#f5f5f0"),
      primary: token("--accent", "#bef264")
    });
  };

  const onSchemeChange = (): void => { if (options.settings.get().theme === "system") apply(); };
  colorScheme.addEventListener("change", onSchemeChange);
  const unsubscribe = options.settings.subscribe(() => apply());
  apply();

  return {
    apply,
    destroy() {
      colorScheme.removeEventListener("change", onSchemeChange);
      unsubscribe();
    }
  };
}

export interface SettingsView {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export interface SettingsViewOptions {
  readonly panel: HTMLElement;
  readonly tabs: HTMLElement;
  readonly body: HTMLElement;
  readonly status: HTMLElement;
  readonly platform: SettingsPlatform;
  readonly reducedMotion?: MediaQueryList;
}

const LOCAL_LISTS: Readonly<Record<LocalListKey, { readonly title: string; readonly hint: string; readonly placeholder: string; readonly kind: "relay" | "server" }>> = {
  backupRelays: {
    title: "Backup relays",
    hint: "Used for reading and publishing whenever your account has no relay list of its own.",
    placeholder: "wss://relay.example.com",
    kind: "relay"
  },
  lookupRelays: {
    title: "Lookup relays",
    hint: "Where the shell looks first for profiles, relay lists and napplet manifests it has not cached.",
    placeholder: "wss://purplepag.es",
    kind: "relay"
  },
  backupBlossomServers: {
    title: "Backup media servers",
    hint: "Uploads fall back to these when your account has not published a BUD-03 server list.",
    placeholder: "https://blossom.example.com",
    kind: "server"
  }
};

export function createSettingsView(options: SettingsViewOptions): SettingsView {
  const { panel, tabs, body, status, platform } = options;
  const reducedMotion = options.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeTab: SettingsTab = "appearance";
  let open = false;
  let renderToken = 0;
  const sectionSubscriptions: Subscription[] = [];

  const setStatus = (message: string, state: "idle" | "busy" | "success" | "error" = "idle"): void => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const section = (title: string, hint: string): { root: HTMLElement; content: HTMLElement } => {
    const root = element("section", "settings-section");
    root.append(element("h3", undefined, title), element("p", "settings-hint", hint));
    const content = element("div");
    root.append(content);
    return { root, content };
  };

  const urlList = (values: readonly string[], empty: string, onRemove?: (url: string) => void, badge?: (url: string) => string | undefined): HTMLElement => {
    if (values.length === 0) return element("p", "settings-empty", empty);
    const list = element("ul", "settings-list");
    for (const url of values) {
      const item = document.createElement("li");
      item.append(element("span", "settings-url", url));
      const actions = element("div", "settings-row-actions");
      const label = badge?.(url);
      if (label) actions.append(element("span", "settings-badge", label));
      if (onRemove) {
        const remove = element("button", "settings-remove", "Remove");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${url}`);
        remove.addEventListener("click", () => onRemove(url));
        actions.append(remove);
      }
      item.append(actions);
      list.append(item);
    }
    return list;
  };

  const addForm = (placeholder: string, label: string, onSubmit: (value: string, showError: (message: string) => void) => void): HTMLElement => {
    const wrapper = element("div");
    const form = element("form", "settings-add");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", label);
    const submit = element("button", undefined, "Add");
    submit.type = "submit";
    const error = element("p", "settings-error");
    form.append(input, submit);
    wrapper.append(form, error);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "";
      onSubmit(input.value, (message) => { error.textContent = message; });
      if (!error.textContent) input.value = "";
    });
    return wrapper;
  };

  const appearanceSection = (): HTMLElement => {
    const { root, content } = section("Theme", "Choose a light or dark shell, or follow your operating system.");
    const group = element("div", "settings-choices");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Theme");
    const current = platform.settings.get().theme;
    for (const option of THEME_OPTIONS) {
      const button = element("button", "settings-choice", option.label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(option.id === current));
      button.addEventListener("click", () => {
        platform.settings.update({ theme: option.id });
        setStatus(`Theme set to ${option.label.toLowerCase()}.`, "success");
        render();
      });
      group.append(button);
    }
    content.append(group);
    return root;
  };

  const localListSection = (key: LocalListKey): HTMLElement => {
    const config = LOCAL_LISTS[key];
    const { root, content } = section(config.title, config.hint);
    const values = platform.settings.get()[key];
    const normalize = config.kind === "relay" ? normalizeRelay : normalizeMediaServer;
    const limit = config.kind === "relay" ? relayLimit : undefined;

    content.append(urlList(values, "Nothing configured yet.", (url) => {
      platform.settings.update({ [key]: values.filter((entry) => entry !== url) });
      setStatus(`Removed ${url}.`, "success");
      render();
    }));
    content.append(addForm(config.placeholder, `Add to ${config.title.toLowerCase()}`, (value, showError) => {
      const checked = checkUrl(value, normalize, values, limit);
      if (!checked.ok) { showError(checked.error); return; }
      platform.settings.update({ [key]: [...values, checked.url] });
      setStatus(`Added ${checked.url}.`, "success");
      render();
    }));
    return root;
  };

  /** Wraps a publishing edit so every path reports through the shared status line. */
  const publishing = async (busy: string, done: string, run: () => Promise<unknown>): Promise<void> => {
    setStatus(busy, "busy");
    try {
      await run();
      setStatus(done, "success");
    } catch (error) {
      setStatus(errorMessage(error), "error");
    }
    render();
  };

  const accountSection = (options_: {
    readonly title: string;
    readonly hint: string;
    readonly placeholder: string;
    readonly empty: string;
    readonly source: Observable<{ values: readonly string[]; badge?: (url: string) => string | undefined } | undefined>;
    readonly normalize: (url: string) => string;
    readonly limit?: number;
    readonly add: (url: string) => Promise<unknown>;
    readonly remove: (url: string) => Promise<unknown>;
  }): HTMLElement => {
    const { root, content } = section(options_.title, options_.hint);
    content.append(element("p", "settings-empty", "Loading…"));
    // Subscribed rather than fetched once: a list published from another client, or a change of
    // account, repaints the section on its own. This replaces a render-token staleness guard.
    sectionSubscriptions.push(combineLatest([activePubkey$, options_.source]).subscribe({
      next: ([pubkey, list]) => {
        if (!pubkey) {
          content.replaceChildren(element("p", "settings-empty", "Connect an identity to see and edit this list."));
          return;
        }
        if (!list) return;
        const { values, badge } = list;
        content.replaceChildren();
        content.append(urlList(values, options_.empty, (url) => {
          void publishing(`Removing ${url}…`, `Removed ${url}.`, () => options_.remove(url));
        }, badge));
        content.append(addForm(options_.placeholder, `Add to ${options_.title.toLowerCase()}`, (value, showError) => {
          const checked = checkUrl(value, options_.normalize, values, options_.limit);
          if (!checked.ok) { showError(checked.error); return; }
          void publishing(`Publishing ${checked.url}…`, `Published ${checked.url}.`, () => options_.add(checked.url));
        }));
      },
      error: (error: unknown) => content.replaceChildren(element("p", "settings-empty", errorMessage(error)))
    }));
    return root;
  };

  const accountRelaySection = (): HTMLElement => accountSection({
    title: "Your relays",
    hint: "Your published NIP-65 list. Editing it signs and publishes a new kind 10002 event.",
    placeholder: "wss://relay.example.com",
    empty: "You have not published a relay list yet.",
    normalize: normalizeRelay,
    limit: relayLimit,
    source: mailboxes$.pipe(map((mailboxes) => mailboxes && {
      values: [...new Set([...mailboxes.inboxes, ...mailboxes.outboxes])],
      badge: (url: string): string | undefined => {
        const read = mailboxes.inboxes.includes(url);
        const write = mailboxes.outboxes.includes(url);
        return read && write ? "read/write" : read ? "read" : write ? "write" : undefined;
      }
    })),
    add: (url) => platform.accountLists.addMailboxRelay(url),
    remove: (url) => platform.accountLists.removeMailboxRelay(url)
  });

  const accountServerSection = (): HTMLElement => accountSection({
    title: "Your media servers",
    hint: "Your published BUD-03 list. Editing it signs and publishes a new kind 10063 event.",
    placeholder: "https://blossom.example.com",
    empty: "You have not published a media server list yet.",
    normalize: normalizeMediaServer,
    source: ownBlossomServers$.pipe(map((servers) => servers && { values: servers })),
    add: (url) => platform.accountLists.addBlossomServer(url),
    remove: (url) => platform.accountLists.removeBlossomServer(url)
  });

  const renderTabs = (): void => {
    tabs.replaceChildren();
    for (const tab of SETTINGS_TABS) {
      const button = element("button", "settings-tab", tab.label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(tab.id === activeTab));
      if (tab.id === activeTab) button.append(element("span", "settings-tab-underline"));
      button.addEventListener("click", () => {
        if (activeTab === tab.id) return;
        activeTab = tab.id;
        render();
      });
      tabs.append(button);
    }
  };

  const dropSections = (): void => {
    for (const subscription of sectionSubscriptions) subscription.unsubscribe();
    sectionSubscriptions.length = 0;
  };

  const render = (): void => {
    renderToken += 1;
    dropSections();
    renderTabs();
    body.replaceChildren();
    if (activeTab === "appearance") body.append(appearanceSection());
    else if (activeTab === "relays") body.append(accountRelaySection(), localListSection("backupRelays"), localListSection("lookupRelays"));
    else body.append(accountServerSection(), localListSection("backupBlossomServers"));
  };

  return {
    isOpen: () => open,
    open() {
      if (open) return;
      open = true;
      setStatus("");
      render();
      panel.hidden = false;
      gsap.killTweensOf(panel);
      if (reducedMotion.matches) return;
      gsap.fromTo(panel,
        { autoAlpha: 0, y: -12, scale: .975, filter: "blur(6px)" },
        { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", duration: .3, ease: "power4.out", clearProps: "filter" }
      );
    },
    close() {
      if (!open) return;
      open = false;
      renderToken += 1;
      dropSections();
      gsap.killTweensOf(panel);
      if (reducedMotion.matches) { panel.hidden = true; return; }
      gsap.to(panel, {
        autoAlpha: 0, y: -8, scale: .985, filter: "blur(4px)", duration: .16, ease: "power2.in",
        onComplete: () => {
          panel.hidden = true;
          gsap.set(panel, { clearProps: "opacity,visibility,transform,filter" });
        }
      });
    },
    destroy() {
      renderToken += 1;
      dropSections();
      gsap.killTweensOf(panel);
      tabs.replaceChildren();
      body.replaceChildren();
    }
  };
}

export type { ShellSettings };
