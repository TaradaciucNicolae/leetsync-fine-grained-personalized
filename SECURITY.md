# Security

## Recommended Setup

Use a dedicated GitHub repository for synced LeetCode solutions. Configure a
GitHub Fine-Grained Personal Access Token with:

- Repository access: **Only select repositories**
- Repository: select only the dedicated LeetCode solutions repository
- Repository permissions: **Contents -> Read and write**
- Account permissions: none unless GitHub changes the API requirements

Prefer a token expiration date. Revoke or rotate the token immediately if it may
have been exposed.

## Credential Handling

- Enter the token only in the extension popup/options UI.
- Never commit a real token to this repository.
- Never include tokens, cookies, LeetCode session data, private repository URLs,
  or browser profile data in bug reports.
- A saved token is stored in Firefox extension local storage under
  `leetsync_config.token`.
- The token is only intended to be sent to `https://api.github.com`.

## Reporting Vulnerabilities

If GitHub private vulnerability reporting is enabled for the published
repository, use that as the preferred reporting channel.

If private vulnerability reporting is not available, open a minimal public issue
that says you have a security concern, but do not include exploit details,
tokens, cookies, private URLs, or other secrets.

## Security-Sensitive Changes

Changes to authentication, GitHub API requests, LeetCode data retrieval, browser
permissions, credential storage, or generated repository destinations should be
reviewed with a security audit before release.
