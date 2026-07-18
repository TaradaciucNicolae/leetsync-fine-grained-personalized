# Privacy

LeetSync Fine-Grained - Personalized is a local Firefox extension. It does not
use analytics, telemetry, advertising, tracking scripts, a project-operated
backend, or unrelated third-party data transmission.

Synchronization sends selected data to LeetCode and GitHub as described below.

## Local Storage

The extension stores these values in Firefox extension local storage
(`browser.storage.local`):

- `leetsync_config.username`: configured GitHub username or organization
- `leetsync_config.repository`: configured GitHub repository name
- `leetsync_config.token`: GitHub Fine-Grained Personal Access Token
- `leetsync_last_upload`: latest upload status shown in the popup
- `leetsync_stats`: local sync counters

Earlier development builds used `leethub_config.token`; current builds migrate
that value to `leetsync_config.token`.

The PAT is not stored in `storage.sync`, `window.localStorage`, cookies, or a
remote service.

## LeetCode Data Processed

On LeetCode problem pages, the extension may process:

- Current problem URL
- Problem title, number, slug, difficulty, tags, and problem statement
- Accepted submission source code and language
- Runtime and memory statistics when LeetCode provides them

LeetCode requests use the user's authenticated browser session.

## GitHub Data Sent

GitHub REST requests use the configured Fine-Grained PAT and are sent only to
`https://api.github.com`.

During sync, the extension may upload to the configured GitHub repository:

- Generated problem `README.md`
- Accepted solution source file
- Problem metadata and original LeetCode URL
- Runtime and memory statistics in Git commit messages when available

The GitHub PAT is not sent to LeetCode content scripts, injected LeetCode page
scripts, a project-operated backend, or any origin other than
`https://api.github.com`.

## Firefox Data Collection Declaration

The manifest declares these required data categories:

- `authenticationInfo`: GitHub owner/repository configuration and the
  Fine-Grained PAT used for GitHub API requests
- `browsingActivity`: the current LeetCode problem URL, which may be uploaded
  to the configured GitHub repository
- `websiteContent`: LeetCode problem metadata and accepted solution source code
  uploaded to the configured GitHub repository

## Not Used

This project does not use or send:

- Analytics events
- Telemetry
- Advertising identifiers
- Browsing history unrelated to LeetCode problem pages
- GitHub tokens to any project-operated server
- LeetCode cookies or session data to GitHub
- User data for sale
- User data to unrelated third parties

Do not include tokens, cookies, private repository URLs, or LeetCode session
details in public issues.
