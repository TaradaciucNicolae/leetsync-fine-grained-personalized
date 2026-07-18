# Privacy

LeetSync Fine-Grained - Personalized is a local Firefox extension. It does not
use analytics, telemetry, advertising, tracking scripts, or a project-operated
external backend. It does transmit the data needed for its sync feature to
LeetCode and GitHub as described below.

## Data Stored Locally

The extension stores configuration in Firefox extension local storage:

- `leetsync_config.username`: configured GitHub username or organization
- `leetsync_config.repository`: configured GitHub repository name
- `leetsync_config.token`: user-provided GitHub Fine-Grained Personal Access
  Token
- `leetsync_last_upload`: last upload status shown in the popup
- `leetsync_stats`: local sync counters

Earlier development builds used `leethub_config.token`; current builds migrate
that value to `leetsync_config.token`.

The token is not stored in `storage.sync`, `window.localStorage`, cookies, or a
remote service.

## Firefox Data Collection Declaration

The Firefox manifest declares these required data categories:

- `authenticationInfo`: the configured GitHub username/repository and
  Fine-Grained PAT are used to authenticate GitHub API requests. The PAT is
  stored locally in Firefox extension storage and is sent only to
  `https://api.github.com`.
- `browsingActivity`: the extension processes the currently open LeetCode
  problem URL. That LeetCode URL may be included in the generated README
  uploaded to the user's configured GitHub repository. The extension does not
  maintain a general browsing history.
- `websiteContent`: the extension processes LeetCode problem metadata and the
  user's accepted solution source code. This content is transmitted only to the
  user's configured GitHub repository through `https://api.github.com` as part
  of synchronization.

## Network Requests

The extension makes runtime requests only for its core functionality:

- LeetCode requests to `https://leetcode.com/graphql` use the user's existing
  LeetCode browser session to retrieve problem metadata and the user's own
  submission information.
- GitHub REST requests to `https://api.github.com` use the configured
  Fine-Grained PAT to test the selected repository and create or update files.

The GitHub token is only intended to be sent to `https://api.github.com`.
LeetCode content scripts and the injected page bridge do not receive the GitHub
token.

## Data Sent to GitHub

When syncing, the extension sends the generated README content and accepted
solution source code to the configured GitHub repository through the GitHub REST
API.

Generated READMEs include metadata, a LeetCode reference link, and the full
normalized problem statement when LeetCode provides it to the extension.

## Data Not Used Or Sent

This project does not collect, use, sell, or transmit:

- analytics events
- telemetry
- advertising identifiers
- browsing history unrelated to LeetCode problem pages
- GitHub tokens to any project-operated server
- LeetCode cookies or session data to GitHub
- user data for sale
- user data to unrelated third parties

Do not include tokens, cookies, private repository URLs, or LeetCode session
details in bug reports.
