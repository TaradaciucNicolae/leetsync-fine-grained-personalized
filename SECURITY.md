# Security

## Recommended GitHub Token Setup

Use a dedicated GitHub repository for synced LeetCode solutions. Create a
GitHub Fine-Grained Personal Access Token with:

- Repository access: **Only select repositories**
- Repository: only the dedicated LeetCode solutions repository
- Repository permissions: **Contents -> Read and write**
- Account permissions: none unless GitHub changes the API requirements

Prefer a token expiration date. GitHub enforces repository access according to
the selected Fine-Grained PAT configuration; the extension cannot grant itself
access to repositories outside that token.

## Credential Boundaries

- The PAT is stored in Firefox extension local storage as
  `leetsync_config.token`.
- The background script creates the GitHub `Authorization` header.
- The PAT is sent only to `https://api.github.com`.
- LeetCode content scripts and the injected page bridge do not receive the PAT.
- GitHub repository destinations are built from saved extension configuration.

Do not commit real tokens, browser storage dumps, cookies, LeetCode session
data, private repository URLs, or browser profile data.

## If a Token Is Exposed

1. Revoke the token in GitHub.
2. Remove the exposed value from issues, logs, screenshots, local files, and
   repository history where applicable.
3. Create a new Fine-Grained PAT with the minimum repository access described
   above.
4. Save the replacement token in the extension popup.

## Reporting Vulnerabilities

Use GitHub private vulnerability reporting if it is enabled for the published
repository.

If private reporting is unavailable, open a minimal public issue requesting a
private contact path. Do not include exploit details, tokens, cookies, private
URLs, or other secrets in public issues.

## Security-Sensitive Changes

Run a security review before releasing changes to authentication, GitHub API
requests, LeetCode data retrieval, browser permissions, credential storage, or
repository destination logic.
