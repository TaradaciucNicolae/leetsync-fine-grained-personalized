# Agent Development Rules

These rules apply to Codex and other AI/development agents working on this
repository.

## Security Invariants

- Do not add broad GitHub OAuth `repo` scope or a GitHub OAuth flow.
- Do not accept classic GitHub Personal Access Tokens.
- Do not send the GitHub Fine-Grained PAT outside `https://api.github.com`.
- Do not expose the PAT to LeetCode content scripts, injected page scripts, or
  page bridge code.
- Do not store credentials in `storage.sync`, `window.localStorage`, cookies, or
  a backend.
- Do not commit credentials, browser storage dumps, cookies, browser profiles,
  logs containing secrets, or real user tokens.
- Keep host permissions minimal and document every new permission.
- Do not add analytics or telemetry without an explicit maintainer decision.
- Keep manual historical Accepted sync and automatic Submit -> Accepted sync on
  the same GitHub upload pipeline.
- Preserve the MIT license and upstream LeetHub attribution.

## Review Triggers

Perform a security review before releasing changes to:

- Authentication or token validation
- GitHub API request construction
- LeetCode data extraction or page bridge messaging
- Browser permissions or host permissions
- Credential storage or migration
- Repository owner, repository name, or upload path handling

## Architecture Boundaries

- Popup UI collects configuration and displays status.
- Background script owns GitHub configuration, PAT access, GitHub REST requests,
  and file create/update logic.
- LeetCode content script retrieves LeetCode metadata and accepted submission
  data, but must not receive the PAT.
- Page bridge may inspect LeetCode page/editor state, but must not receive the
  PAT.
- GitHub upload destinations must be derived from saved extension configuration,
  not from LeetCode page content.
