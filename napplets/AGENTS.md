# Napplet implementation rules

## Intent navigation

- Open another napplet through the public intent contract using its archetype and
  payload. Do not name a specific handler unless the user explicitly selected one
  or the living NAP specification requires it.
- Napplet-to-napplet navigation must not ask for per-invocation authorization or
  display an "Allow?" confirmation. Handler discovery, validation, defaults, and
  routing policy belong to the shell.
- Test every cross-napplet open inside the packaged sandbox. It must open through
  intent routing without a browser confirmation. If a confirmation appears, fix
  shell intent policy or the sender's unnecessary explicit-handler request; do not
  add a napplet-local workaround.

## Sandboxed form controls

- Web napplets run in `sandbox="allow-scripts"` iframes. Do not add or depend on
  `allow-forms`; keep runtime sandbox permissions aligned with the living NAP web
  projection.
- Do not use native form submission in napplets. A `<form>` submission is blocked
  by the sandbox even when application code intends to intercept it.
- Implement submit-like interactions with `type="button"` controls and scripted
  event handlers. Preserve keyboard behavior explicitly, including handling Enter
  where users expect it, and call `preventDefault()` for that key event.
- When testing a new napplet, exercise both pointer activation and Enter-key
  activation inside the sandboxed runtime and confirm neither attempts navigation
  nor logs an `allow-forms` browser error.
