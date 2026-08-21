import type { Runtime } from "@kehto/runtime";
import { createCatalogIntentResolver, createIntentService, manifestToIntentCatalogEntry, type CatalogIntentResolver } from "@kehto/services";
import type { NappletWindowManager, PackageStore } from "@platform/napplet-gateway";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";

export interface IntentHostOptions {
  readonly getDefaultHandler?: (archetype: string) => string | undefined;
  readonly chooseHandler?: (archetype: string, candidates: readonly { dTag: string; title?: string }[], sender: string) => string | undefined | Promise<string | undefined>;
  readonly authorizeExplicitHandler?: (sender: string, handler: string) => boolean | Promise<boolean>;
  readonly telemetry?: PlatformTelemetry;
}

export function registerIntentService(runtime: Runtime, store: PackageStore, windows: NappletWindowManager, options: IntentHostOptions = {}): CatalogIntentResolver {
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  const resolver = createCatalogIntentResolver({
    loadCatalog: async () => (await store.listActive()).flatMap((installation) => {
      const archetypes = installation.manifest.archetypes;
      if (!archetypes?.length) return [];
      return [manifestToIntentCatalogEntry({
        dTag: installation.dTag,
        ...(installation.manifest.title ? { title: installation.manifest.title } : {}),
        archetypes: archetypes.map((item) => ({ ...item }))
      })];
    }),
    targets: {
      async dispatch(params) {
        const startedAt = Date.now();
        const reuse = params.behavior?.newWindow !== true && params.behavior?.reuse !== false;
        const caller = windows.findByDTag(params.sender);
        const existingTarget = reuse ? windows.findByDTag(params.handler) : undefined;
        const replaceCaller = params.behavior?.focus !== false && caller !== undefined && caller.identity.dTag !== params.handler;
        const target = existingTarget ?? await windows.create(params.handler, reuse, { deferLayout: replaceCaller });
        // Self-dispatch cannot await its own startup without deadlocking. Other
        // senders wait until target listeners are ready before delivery.
        if (target.identity.dTag !== params.sender) await target.ready;
        if (!existingTarget || target.launch?.type === "intent") {
          windows.setLaunchDescriptor(target.identity.windowId, {
            type: "intent", sender: params.sender, convention: params.convention,
            ...(params.payload === undefined ? {} : { payload: params.payload })
          });
        }
        target.identity.source.postMessage({
          type: "inc.event", topic: params.convention, sender: params.sender,
          ...(params.payload === undefined ? {} : { payload: params.payload })
        }, "*");
        if (params.behavior?.focus === false) windows.show(target.identity.windowId);
        else windows.focus(target.identity.windowId, caller?.identity.windowId);
        telemetry.record("intent.completed", Date.now() - startedAt, { handler: params.handler });
        return { windowId: target.identity.windowId };
      }
    },
    ...(options.getDefaultHandler ? { getDefaultHandler: options.getDefaultHandler } : {}),
    ...(options.chooseHandler ? {
      chooseHandler: (archetype, candidates, sender) => options.chooseHandler?.(archetype, candidates.map(({ dTag, title }) => ({ dTag, ...(title ? { title } : {}) })), sender)
    } : {}),
    ...(options.authorizeExplicitHandler ? {
      authorizeExplicitHandler: (sender, handler) => options.authorizeExplicitHandler?.(sender, handler) ?? false
    } : {})
  });
  runtime.registerService("intent", createIntentService({ resolver }));
  return resolver;
}
