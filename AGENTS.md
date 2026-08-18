# Repository instructions

## Applesauce requirements

- For any task involving Applesauce, always activate and follow the installed
  `applesauce` skill.
- For any task involving Applesauce, always use the `applesauce` MCP server at
  `https://mcp.applesauce.build/mcp` for documentation, API, and example
  discovery.
- Never design, implement, modify, or generate Applesauce-related code before
  examining relevant real Applesauce examples through the Applesauce MCP
  server. Base work on those examples and current Applesauce APIs rather than
  memory or invented patterns.
- If the Applesauce skill or MCP server is unavailable, stop Applesauce
  implementation and report the blocker instead of building from assumptions.

## Commits

- Commit every completed change before handing work back to user.
- Keep each commit focused on one logical change.
- Write every commit message as a problem statement using this subject format:
  `problem: <affected subject> <undesirable condition or missing capability>`.
- Keep commit subjects under 50 characters when practical and never over 70
  characters.
- Describe the problem solved, not the solution, implementation, command, or
  files changed. Add a wrapped body only when needed for rationale, breaking
  changes, migrations, reverts, or issue references.
