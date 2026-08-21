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
