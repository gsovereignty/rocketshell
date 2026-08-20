# Napplet implementation rules

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
