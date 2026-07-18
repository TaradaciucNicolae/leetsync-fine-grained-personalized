# LeetSync Fine-Grained - Personalized

Privacy-first Firefox extension for automatically syncing accepted LeetCode
solutions to a single GitHub repository using a Fine-Grained Personal Access
Token.

This is an unofficial, independently maintained project derived from the
open-source LeetHub project. It is not affiliated with or endorsed by LeetCode,
GitHub, Mozilla, Qasim Wani, or the original LeetHub maintainers.

## Overview

LeetSync Fine-Grained - Personalized watches LeetCode problem pages in Firefox.
When an accepted solution is detected, it prepares solution metadata and asks the
background extension context to create or update files in one configured GitHub
repository.

The extension also includes a manual fallback, **Sync Current Accepted
Solution**, for syncing the latest historical Accepted submission for the
currently open LeetCode problem without submitting again.

## Why This Project Exists

The original LeetHub workflow used broad GitHub OAuth repository access. This
project is focused on a narrower privacy and security model:

- User-provided GitHub Fine-Grained Personal Access Token.
- Token restricted by GitHub to one selected repository.
- Minimal Firefox permissions.
- No GitHub OAuth flow.
- No broad OAuth `repo` scope.
- No analytics or telemetry.
- No project-operated backend.

## Features

- Automatic sync when a LeetCode submission is detected as Accepted.
- Manual **Sync Current Accepted Solution** button for previously solved
  problems.
- GitHub Fine-Grained PAT configuration in the popup/options UI.
- Single configured GitHub username and repository.
- Safe create/update behavior for `README.md` and `solution.ext`.
- Language-based solution file extensions.
- Firefox-focused WebExtension manifest.
- No analytics, telemetry, advertising, or external backend.

## Security Model

- The GitHub token is entered by the user at runtime.
- The token is stored only in Firefox extension local storage under
  `leetsync_config.token`.
- Existing installs using the earlier internal key `leethub_config.token` are
  migrated to `leetsync_config.token`.
- The popup can read only the token the user is actively entering; the saved
  token is read only by the background extension context.
- The GitHub `Authorization` header is created only in `scripts/background.js`.
- The token is only intended to be sent to `https://api.github.com`.
- LeetCode content scripts and the injected page bridge do not receive the
  GitHub token.
- The LeetCode page cannot provide an arbitrary GitHub API origin.
- GitHub upload destination is built only from the saved GitHub username and
  repository name.

The primary repository-level access boundary is enforced by GitHub through the
permissions on the user's Fine-Grained PAT. The extension cannot grant itself
access to repositories that the token cannot access.

## Recommended Fine-Grained PAT Setup

Create a GitHub Fine-Grained Personal Access Token with:

- Repository access: **Only select repositories**
- Repository: select only your dedicated LeetCode solutions repository
- Repository permissions: **Contents -> Read and write**
- Account permissions: none unless GitHub changes the API requirements

Use an expiration date where practical, and rotate or revoke the token if it may
have been exposed.

## Installation for Development

This repository is intended for temporary local development installation in
Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select this repository's `manifest.json`.
4. Open the extension popup.

Temporary add-ons are removed when Firefox restarts.

## Configuration

Open the extension popup and enter:

- GitHub username or organization
- GitHub repository name
- Fine-Grained Personal Access Token

Click **Save configuration**, then **Test GitHub Connection**.

The token field is a password input. A saved token is not redisplayed in
plaintext.

## Usage

Automatic sync:

1. Open a LeetCode problem page.
2. Submit a solution.
3. When LeetCode reports Accepted, the extension prepares and uploads the
   solution.

Manual historical sync:

1. Open a LeetCode problem page that your logged-in LeetCode account has solved.
2. Open the extension popup.
3. Click **Sync Current Accepted Solution**.
4. The extension finds the latest Accepted submission for that problem, retrieves
   its code and language, and uses the same GitHub upload pipeline as automatic
   sync.

## Output Structure

Files are written to the configured repository as:

```text
0001-two-sum/
  README.md
  solution.py
```

The directory is based on the problem number and slug. The solution filename is
`solution` plus the extension mapped from the submitted language. Syncing the
same problem and language again updates the existing file instead of creating a
duplicate.

Generated solution READMEs currently include:

- Problem number and title
- Difficulty
- Original LeetCode URL
- Topic tags when available
- Accepted runtime/memory stats when available
- A LeetCode reference note

For public repository safety, generated READMEs do **not** currently copy the
full LeetCode problem statement, examples, or constraints. The content script
still retrieves problem metadata from LeetCode so the extension can identify and
label the solution correctly.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Security

See [SECURITY.md](SECURITY.md).

## Known Limitations

- LeetCode is not a stable public integration API for browser extensions.
  Changes to LeetCode GraphQL fields, submission polling, or page behavior may
  require extension updates.
- Manual historical sync requires the user to be logged in to LeetCode in the
  current Firefox profile.
- This is a development-ready Firefox extension and has not been broadly tested
  across every LeetCode language and UI variant.
- The current icon asset is inherited from the upstream LeetHub project and may
  be worth replacing before broader public distribution.

## Project Status

This is an independent personal project prepared for public GitHub release. It
is not an official LeetCode, GitHub, Mozilla, or LeetHub project.

## Credits

LeetSync Fine-Grained - Personalized is derived from the open-source LeetHub
project by Qasim Wani and has been significantly modified for:

- Firefox-focused usage
- Fine-Grained GitHub PAT authentication
- Restricted single-repository access
- Removal of broad GitHub OAuth `repo` scope
- Privacy-focused architecture
- Manual historical Accepted solution synchronization
- Updated LeetCode integration

This attribution does not imply endorsement by Qasim Wani or the LeetHub
maintainers.

## License

This project preserves the existing MIT license and required attribution. See
[LICENSE](LICENSE).
