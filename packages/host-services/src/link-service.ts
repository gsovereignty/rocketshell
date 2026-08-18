import type { Runtime, ServiceHandler } from "@kehto/runtime";
import type { LinkOpenErrorCode, LinkOpenMessage, LinkOpenResultMessage } from "@napplet/nap/link/types";

export interface LinkPolicy {
  readonly openExternal: (url: URL) => boolean;
  readonly confirm?: (windowId: string, url: URL) => boolean | Promise<boolean>;
  readonly allowHttpLocalhost?: boolean;
}

const isLocalhost = (hostname: string): boolean => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const denied = (id: string, error: LinkOpenErrorCode): LinkOpenResultMessage => ({
  type: "link.open.result" as const,
  id,
  status: "denied" as const,
  error
});

function createPolicyLinkService(policy: LinkPolicy): ServiceHandler {
  return {
    descriptor: {
      name: "link",
      version: "1.0.0",
      description: "Policy-mediated user-visible navigation"
    },
    handleMessage(windowId, message, send) {
      const request = message as unknown as Partial<LinkOpenMessage>;
      const id = typeof request.id === "string" ? request.id : "";
      if (request.type !== "link.open" || typeof request.url !== "string") {
        send(denied(id, "invalid-url"));
        return;
      }

      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        send(denied(id, "invalid-url"));
        return;
      }

      if (url.protocol !== "https:" && url.protocol !== "http:") {
        send(denied(id, "unsupported-scheme"));
        return;
      }
      if (url.protocol === "http:" && !(policy.allowHttpLocalhost && isLocalhost(url.hostname))) {
        send(denied(id, "blocked-by-policy"));
        return;
      }
      if (url.username || url.password) {
        send(denied(id, "blocked-by-policy"));
        return;
      }

      void Promise.resolve(policy.confirm?.(windowId, url) ?? true)
        .then((confirmed) => {
          if (!confirmed) {
            send(denied(id, "user-denied"));
            return;
          }
          try {
            if (policy.openExternal(url)) {
              const result: LinkOpenResultMessage = { type: "link.open.result", id, status: "opened" };
              send(result);
            } else {
              send(denied(id, "browser-failure"));
            }
          } catch {
            send(denied(id, "browser-failure"));
          }
        })
        .catch(() => send(denied(id, "user-denied")));
    }
  };
}

export function registerLinkService(runtime: Runtime, policy: LinkPolicy): void {
  runtime.registerService("link", createPolicyLinkService(policy));
}
