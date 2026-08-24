# `@platform/napplet-markdown-editor`

Public browser-only Markdown editor contract for independently packaged
napplets. It stores plain Markdown and supplies CodeMirror live preview,
formatting commands, editable tables, non-navigating links, highlighted fenced
code, and host-mediated image previews.

Consumers provide resource loading explicitly. Napplet integrations pass
`@napplet/sdk`'s `resource.bytes`; this package never imports shell code, opens a
network connection, stores browser state, or changes Nostr/NAP wire formats.

Published consumers resolve compiled `dist/index.js`. Workspace napplets select
the explicit `source` export condition so their independent Vite single-file
builds do not depend on committed generated output. `prepack` always rebuilds
the public artifact.
