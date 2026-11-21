# Project collaboration

The user requested Codex → Mistral Vibe collaboration through the `mistral_vibe`
MCP server. Codex remains responsible for the work and final verification.

- For substantial coding tasks, send Mistral a focused consultation or review with
  `vibe_task`, including the user's goal, relevant decisions, and file paths or
  `context_files`. Vibe cannot automatically see this conversation.
- Use `vibe_update_context` to keep a concise shared summary of goals, decisions,
  changes, checks, and remaining work. Update it after a substantial change so the
  next handoff has current context. Saving a summary alone does not call Mistral.
- Reuse a meaningful `conversation` name for follow-ups. Default to `consult`;
  use `edit` for a clearly scoped implementation. Do not edit the same files while
  a Vibe edit task is running. Review its changes and run appropriate checks.
- Never include credentials, `.env` contents, or unrelated private files in a
  handoff. Don't describe a failed or stopped task as completed. If authentication
  or the connector is unavailable, explain briefly and continue independent work.
- If the MCP tools are absent from the current session, the local client can call
  the registered server: `tools/vibe-mcp/.venv/bin/python tools/vibe-mcp/client.py
  vibe_status`. For `vibe_task` or `vibe_update_context`, supply the tool arguments
  as JSON on stdin. See `tools/vibe-mcp/README.md` for setup and tool behaviour.
- When running inside a delegated Vibe task (`CODEX_VIBE_DELEGATED=1`), do not
  delegate back to Codex or Vibe. Perform the assigned task and return findings.

The bridge is local developer tooling in `tools/vibe-mcp`; its dependencies are
separate from the app's Node dependencies.

# Product: isomux agent office

isomux is a visual office for teams of AI agents, built on Mistral. The user is the
host; agents are their staff, sitting at desks in a 3D isometric office.

- **All AI runs on Mistral** (chat on `MISTRAL_MODEL` = Le Chonk / mistral-large-latest;
  voice on Voxtral 3 via `/v1/audio/speech` + `/v1/audio/transcriptions`). Confirm
  model ids/endpoints against docs.mistral.ai before writing a Mistral call. No other
  providers; local mode may use an OpenAI-compatible local endpoint only if explicitly
  enabled by the user.
- **Secrets stay server-side** (`.env`), never sent to the browser or to agents.
- **No fake actions**: agents may only report what tools actually did; errors are shown.
- **Risky actions need human approval via Raise Hand and run exactly once after it**
  (idempotency key on the approval), with every decision in the audit log.
- Keep the existing Three.js office and its look; no new frameworks unless essential.
- Working rules: claim tasks in `docs/STATUS.md`, update STATUS after each feature,
  plain commit messages.
