# `@platform/napplet-markdown-editor`

Public browser-only Markdown editor contract for independently packaged
napplets. It stores plain Markdown and keeps all Markdown syntax visible while
rendering Markdown typography and supplying formatting commands. Headings,
emphasis, tables, links, fenced code, and media references always remain
editable source.

This package never imports shell code, opens a network connection, stores browser
state, or changes Nostr/NAP wire formats.

Published consumers resolve compiled `dist/index.js`. Workspace napplets select
the explicit `source` export condition so their independent Vite single-file
builds do not depend on committed generated output. `prepack` always rebuilds
the public artifact.
