import type { Runtime } from "@kehto/runtime";
import { createCatalogIntentResolver, createIntentService, manifestToIntentCatalogEntry, type CatalogIntentResolver } from "@kehto/services";
import type { NappletWindowManager, PackageStore } from "@platform/napplet-gateway";

export interface IntentHostOptions {
  readonly getDefaultHandler?: (archetype: string) => string | undefined;
  readonly chooseHandler?: (archetype: string, candidates: readonly { dTag: string; title?: string }[], sender: string) => string | undefined | Promise<string | undefined>;
  readonly authorizeExplicitHandler?: (sender: string, handler: string) => boolean | Promise<boolean>;
}

export function registerIntentService(runtime: Runtime, store: PackageStore, windows: NappletWindowManager, options: IntentHostOptions = {}): CatalogIntentResolver {
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
        const target = windows.findByDTag(params.handler) ?? await windows.create(params.handler);
        // Self-dispatch cannot await its own startup without deadlocking. Other
        // senders wait until target listeners are ready before delivery.
        if (target.identity.dTag !== params.sender) await target.ready;
        target.identity.source.postMessage({
          type: "inc.event", topic: params.convention, sender: params.sender,
          ...(params.payload === undefined ? {} : { payload: params.payload })
        }, "*");
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
