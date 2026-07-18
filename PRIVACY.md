# Privacy

LeetSync Fine-Grained - Personalized is a local Firefox extension. It does not
use analytics, telemetry, advertising, tracking scripts, or a project-operated
external backend.

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

Generated READMEs include metadata and a LeetCode reference link. They do not
currently copy full LeetCode problem statements.

## Data Not Collected

This project does not collect or transmit:

- analytics events
- telemetry
- advertising identifiers
- browsing history unrelated to LeetCode problem pages
- GitHub tokens to any project-operated server
- LeetCode cookies or session data to GitHub

Do not include tokens, cookies, private repository URLs, or LeetCode session
details in bug reports.
