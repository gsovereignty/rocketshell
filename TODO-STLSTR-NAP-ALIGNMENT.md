# TODO: STLstr and Napplet alignment

Close the remaining gaps between this host, STLstr's working integration, and
the Napplet specifications. Existing partial implementations do not count as
complete until the acceptance checks below pass with a production Napplet.

## Intent routing

- [ ] Route Napplet requests by archetype rather than URL, route name, or
      concrete Napplet location.
  - Resolve candidates from installed, signed manifests.
  - Keep URLs and shell navigation details private to the host.
  - Add a browser test proving the caller supplies only an archetype, action,
    convention, and payload.

- [ ] Make `intent.open()` pass exclusively through the shell intent service.
  - Apply default-handler selection and user choice before opening a target.
  - Prevent callers from bypassing mediation with an iframe or artifact URL.
  - Return the standard structured intent result for success and failure.

- [ ] Validate actions and conventions before dispatch.
  - Record supported actions and conventions from each installed manifest.
  - Reject unsupported combinations without opening or focusing a window.
  - Test unknown archetypes, unsupported actions, unsupported conventions, and
    explicit handlers.

- [ ] Return the intent result before navigation can destroy the caller.
  - Send the correlated result envelope before replacing, closing, or
    navigating the calling surface.
  - Add a regression test where successful navigation unmounts the caller.

- [ ] Buffer cold-start intent payloads until the receiver is ready.
  - Wait for the target's NAP-SHELL readiness handshake before delivery.
  - Deliver each payload once to the resolved target only.
  - Cover cold start, reuse, concurrent opens, timeout, and target teardown.

## Manifest capabilities

- [ ] Derive every Napplet capability from its signed manifest declarations.
  - Reject undeclared capability calls.
  - Refuse activation when a required capability is unavailable.
  - Scope grants to publisher, `dTag`, and aggregate hash; re-evaluate them on
    package updates.
  - Test that `shell.supports()` matches the environment granted to that exact
    Napplet instance.

## Host-owned services

- [ ] Keep keys, relay connections, uploads, and resource fetching inside the
      host.
  - Expose only structured-clone-safe NAP request and result values.
  - Never expose signers, private keys, relay objects, upload credentials,
    browser persistence handles, or raw network primitives to Napplet code.
  - Exercise signing, relay queries, Blossom upload, and resource retrieval
    through mediated services in browser tests.

## Napplet isolation

- [ ] Seal and sandbox every Napplet iframe before its code runs.
  - Use `sandbox="allow-scripts"` without `allow-same-origin`.
  - Install namespace/bootstrap code before application code.
  - Serve only verified package artifacts with restrictive response policy.
  - Test opaque origin, blocked direct network access, blocked host DOM access,
    and cleanup after window destruction.

## Identity lifecycle

- [ ] Push account changes through the NAP-IDENTITY channel.
  - Send the signed-out sentinel and active public key through the standard
    identity-change envelope.
  - Notify every eligible live Napplet after login, logout, or account switch.
  - Do not send identity changes through INC or application-specific topics.
  - Test account changes during active subscriptions and in-flight signing.

## Completion gate

- [ ] Run these checks against at least one built STLstr Napplet, not only the
      synthetic reference fixture.
- [ ] Pass unit, conformance, and browser suites with frozen dependencies.
- [ ] Document supported NAP versions and any deliberate unsupported optional
      domains.
