import type { Runtime } from "@kehto/runtime";
import { createHttpUploader, createUploadService } from "@kehto/services";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";

export interface UploadHostOptions {
  readonly blossomServers: readonly string[];
  readonly signEvent: (template: EventTemplate) => Promise<NostrEvent>;
  readonly fetch?: typeof fetch;
  readonly maxBytes?: number;
}

const normalizeServer = (raw: string): string => {
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new TypeError("Blossom server scheme forbidden");
  url.username = ""; url.password = ""; url.hash = ""; url.search = "";
  return url.href.replace(/\/$/, "");
};

export interface UploadServiceRegistration {
  /** Re-registers the service against a new server list, e.g. after the settings panel edits it. */
  update(blossomServers: readonly string[]): void;
  /** The server list currently backing the service. */
  servers(): readonly string[];
}

export function registerUploadService(runtime: Runtime, options: UploadHostOptions): UploadServiceRegistration {
  let current: string[] = [];

  const register = (blossomServers: readonly string[]): void => {
    const servers = [...new Set(blossomServers.map(normalizeServer))];
    if (servers.length === 0) throw new TypeError("At least one Blossom server is required");
    const uploader = createHttpUploader({
      rails: { blossom: { servers } }, defaultRail: "blossom",
      signEvent: options.signEvent,
      ...(options.fetch ? { fetch: options.fetch } : {})
    });
    runtime.registerService("upload", createUploadService({
      uploader,
      uploadInfo: {
        rails: [{ rail: "blossom", enabled: true, returns: ["url", "sha256", "size", "mimeType", "nip94"] }],
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes })
      }
    }));
    current = servers;
  };

  register(options.blossomServers);
  return { update: register, servers: () => current };
}
