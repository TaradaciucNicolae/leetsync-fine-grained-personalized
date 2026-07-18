# Agent Development Rules

These rules are for Codex and other AI/development agents working on this
repository.

## Non-Negotiable Security Rules

- Never introduce broad GitHub OAuth `repo` scope.
- Never introduce classic GitHub Personal Access Token authentication.
- Never send the GitHub Fine-Grained PAT outside `https://api.github.com`.
- Never expose the PAT to LeetCode page scripts.
- Never expose the PAT to the LeetCode content script or page bridge.
- Never use `storage.sync` for credentials.
- Never use `window.localStorage`, cookies, or a backend for GitHub credentials.
- Never commit credentials, debug storage dumps, browser profiles, cookies, or
  real user tokens.
- Never add analytics or telemetry without an explicit maintainer decision.
- Keep Firefox permissions minimal.
- Document every new host permission and why it is required.
- Manual and automatic sync must reuse the same GitHub upload pipeline.
- Preserve the MIT license and upstream LeetHub attribution.
- Changes to authentication, networking, browser permissions, credential
  storage, or repository destination logic require a security audit.

## Architecture Expectations

- Popup UI may collect configuration and display progress.
- Background script owns GitHub configuration, PAT access, GitHub REST requests,
  and file create/update logic.
- LeetCode content script may retrieve LeetCode metadata and accepted submission
  data, but must not receive the GitHub PAT.
- The page bridge may inspect LeetCode page/editor state, but must not receive
  the GitHub PAT.
- GitHub upload destinations must always be derived from saved extension
  configuration, never from LeetCode page content.
