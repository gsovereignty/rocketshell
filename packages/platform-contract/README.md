# platform-nap-v1 contract

Application Napplets depend on `@project/platform-nap-contract` and public NAP APIs only.

Startup:

```ts
import { assertPlatformProfile } from "@project/platform-nap-contract";

await window.napplet.shell.ready();
assertPlatformProfile(window.napplet.shell);
```

Rules:

- Declare every used domain in signed NIP-5D `requires` tags and manifest content.
- Feature-detect optional domains with `shell.supports()`.
- Use `outbox` for normal Nostr reads and unsigned-template publication.
- Use `relay` only when relay-local behavior matters.
- Treat host-returned signed events as canonical; never predict event IDs.
- Close every subscription and react to identity changes.
- Store UI state through `storage`; fetch external bytes through `resource`.
- Open external pages through `link`; validate intent and INC payload schemas.
- Never bundle Applesauce relay/account packages, private-key signers, host database adapters, direct relay WebSockets, or `window.nostr` integration.

Exports include required/optional domain constants, compatibility versions, startup assertion, stable failures, clone validation, cleanup registry, and installed NAP value/result types.
