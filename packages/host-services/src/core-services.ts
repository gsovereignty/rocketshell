import type { Runtime } from "@kehto/runtime";
import { createConfigService, createLinkService, createThemeService, type ConfigService, type ConfigSettingsContext, type ThemeService } from "@kehto/services";
import type { Theme } from "@napplet/nap/theme/types";
import { createMemoryConfigStore, type ConfigValueStore } from "./config-store.js";

export interface CoreHostServices { readonly theme: ThemeService; readonly config: ConfigService; close(): void }
export interface CoreHostServiceOptions {
  readonly initialTheme?: Theme;
  readonly openSettings: (windowId: string, section: string | undefined, context: ConfigSettingsContext) => void;
  readonly configStore?: ConfigValueStore;
  readonly resolveConfigScope?: (windowId: string) => string | undefined;
  readonly publishTheme?: (theme: Theme) => void;
}

export function registerCoreHostServices(runtime: Runtime, options: CoreHostServiceOptions): CoreHostServices {
  const values = options.configStore ?? createMemoryConfigStore();
  const scopeFor = (windowId: string): string => {
    if (!options.resolveConfigScope) return windowId;
    const scope = options.resolveConfigScope(windowId);
    if (!scope) throw new Error("Config identity unavailable");
    return scope;
  };
  const theme = createThemeService({
    ...(options.initialTheme ? { initialTheme: options.initialTheme } : {}),
    onBroadcast: (envelope) => options.publishTheme?.(envelope.theme)
  });
  const config = createConfigService({
    getValues: (windowId) => values.get(scopeFor(windowId)),
    saveValues: (windowId, next) => values.set(scopeFor(windowId), next),
    openSettings: (windowId, section, context) => options.openSettings(windowId, section, context),
    onWindowDestroyed() {}
  });
  runtime.registerService("theme", theme.handler); runtime.registerService("config", config.handler);
  runtime.registerService("link", createLinkService({
    allowedProtocols: ["https:", "http:"],
    open: ({ url }) => {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
      return { status: opened ? "opened" : "denied" };
    }
  }));
  return { theme, config, close() {} };
}
