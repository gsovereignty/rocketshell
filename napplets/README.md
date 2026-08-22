# Napplets

This directory is the complete boundary for napplet-owned material. Runtime,
shell, gateway, and host-service code stays outside it.

- [`AUTHORING-SPEC.md`](AUTHORING-SPEC.md) defines how to create, build, test,
  and publish a napplet.
- [`LOADING-ARCHITECTURE.md`](LOADING-ARCHITECTURE.md) defines how this monorepo
  discovers and loads built-in napplets.
Each direct child containing both `package.json#napplet` and `dist/index.html`
is eligible for built-in discovery. Documentation directories and incomplete
projects are ignored.

## Problem tracker media

Problem descriptions may contain direct Markdown media references:

```markdown
![Screenshot](https://blossom.example/<hash>)
```

`log-new-problem` and `edit-problem` upload selected images or videos through
optional shell-owned NAP-UPLOAD and insert returned HTTPS URLs at textarea
selection. Text composition remains usable when upload is unavailable.

`view-problem` resolves each Markdown media URL through NAP-RESOURCE rather than
ambient browser networking. It renders content-sniffed images, MP4, and WebM
using temporary blob URLs, reports failures in UI and console, and revokes blob
URLs during rerender and teardown. Current shell media limit is 64 MiB.
