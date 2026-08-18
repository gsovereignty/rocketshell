import type { Runtime } from "@kehto/runtime";
import { createLinkService } from "@kehto/services";

export interface LinkPolicy {
  readonly openExternal: (url: URL) => boolean;
  readonly confirm?: (windowId: string, url: URL) => boolean | Promise<boolean>;
  readonly allowHttpLocalhost?: boolean;
}

const isLocalhost = (hostname: string): boolean => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export function registerLinkService(runtime: Runtime, policy: LinkPolicy): void {
  runtime.registerService("link", createLinkService({
    allowedProtocols: ["https:", "http:"],
    async open({ windowId, url }) {
      if (url.protocol === "http:" && !(policy.allowHttpLocalhost && isLocalhost(url.hostname))) return { status: "denied" };
      if (url.username || url.password) return { status: "denied" };
      if (policy.confirm && !(await policy.confirm(windowId, url))) return { status: "denied" };
      return { status: policy.openExternal(url) ? "opened" : "denied" };
    }
  }));
}
