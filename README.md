# LeetSync Fine-Grained - Personalized

Firefox extension that syncs accepted LeetCode solutions to one configured
GitHub repository using a GitHub Fine-Grained Personal Access Token.

This is an unofficial project derived from the open-source LeetHub project. It
is not affiliated with or endorsed by LeetCode, GitHub, Mozilla, Qasim Wani, or
the original LeetHub maintainers.

## What It Does

LeetSync Fine-Grained - Personalized runs on LeetCode problem pages in Firefox.
After the user clicks Submit, it watches that submitted solution. If LeetCode
reports Accepted, the extension sends the solution and problem metadata to the
background script, which creates or updates files in the configured GitHub
repository.

The popup also provides **Sync Current Accepted Solution** for the latest
historical Accepted submission on the currently open LeetCode problem.

## Features

- Automatic Submit -> Accepted sync.
- Manual historical Accepted sync from the popup.
- GitHub Fine-Grained PAT authentication.
- Single saved GitHub owner and repository.
- Create/update behavior for problem `README.md` and `solution.ext` files.
- Language-based solution file extensions.
- Firefox-focused WebExtension manifest.
- No GitHub OAuth flow, broad OAuth `repo` scope, analytics, telemetry,
  advertising, or project-operated backend.

## Security Model

- The PAT is entered in the extension popup and stored in Firefox extension
  local storage as `leetsync_config.token`.
- Earlier development builds that used `leethub_config.token` are migrated to
  `leetsync_config.token`.
- Saved tokens are not redisplayed in the popup.
- The background script owns PAT access, creates the GitHub `Authorization`
  header, and sends GitHub REST requests.
- The PAT is sent only to `https://api.github.com`.
- LeetCode content scripts and the injected page bridge do not receive the PAT.
- GitHub upload paths are built from the saved GitHub owner and repository, not
  from LeetCode page content.
- Repository-level access is enforced by GitHub through the selected
  Fine-Grained PAT permissions.

The manifest host permissions are limited to:

- `https://leetcode.com/*`
- `https://api.github.com/*`

The extension also uses the Firefox `storage` permission for local extension
configuration and sync status.

## Recommended Fine-Grained PAT

Create a GitHub Fine-Grained Personal Access Token with:

- Repository access: **Only select repositories**
- Repository: only the dedicated LeetCode solutions repository
- Repository permissions: **Contents -> Read and write**
- Account permissions: none unless GitHub changes the API requirements

Use an expiration date where practical. Revoke and replace the token if it may
have been exposed.

## Firefox Installation

For development:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select this repository's `manifest.json`.
4. Open the extension popup.

Temporary add-ons are removed when Firefox restarts. For permanent installation,
use a Mozilla-signed unlisted build or another Firefox-supported signing and
installation path.

## Configuration

Open the extension popup and enter:

- GitHub username or organization
- GitHub repository name
- Fine-Grained Personal Access Token

Click **Save configuration**, then **Test GitHub Connection**. The token field
is a password input, and a saved token is not shown again in plaintext.

## Usage

Automatic Submit -> Accepted sync:

1. Open a LeetCode problem page.
2. Submit a solution.
3. When that submitted solution is Accepted, the extension uploads it.

Manual historical Accepted sync:

1. Open a solved LeetCode problem page while logged in.
2. Open the extension popup.
3. Click **Sync Current Accepted Solution**.
4. The extension retrieves the latest Accepted submission for that problem and
   uses the same GitHub upload pipeline as automatic sync.

## Output Structure

Files are written to the configured repository as:

```text
0001-two-sum/
  README.md
  solution.py
```

The directory is based on the problem number and slug. The solution filename is
`solution` plus the extension mapped from the submitted language. Syncing the
same problem and language again updates the existing file.

Generated problem READMEs include:

- Problem number and title
- Difficulty
- Original LeetCode URL
- Topic tags when available
- Full normalized LeetCode problem statement when available
- Examples, explanations, constraints, and notes contained in the problem
  content

Runtime and memory data remain available for GitHub commit messages when
LeetCode provides them, but they are not written into generated problem
READMEs.

## Privacy Summary

See [PRIVACY.md](PRIVACY.md) for details.

The Firefox manifest declares these required data categories:

- `authenticationInfo`: GitHub owner/repository configuration and the
  Fine-Grained PAT used with `https://api.github.com`
- `browsingActivity`: the current LeetCode problem URL, which may be written to
  the configured GitHub repository
- `websiteContent`: LeetCode problem metadata and accepted solution source code
  uploaded to the configured GitHub repository

The project does not use analytics, telemetry, advertising, data sale,
unrelated third-party transmission, or a project-operated backend.

## Security Summary

See [SECURITY.md](SECURITY.md) for token setup, rotation guidance, and
vulnerability reporting.

## Known Limitations

- LeetCode is not a stable browser-extension integration API. Changes to
  LeetCode page behavior, GraphQL fields, or submission polling may require
  extension updates.
- Manual historical Accepted sync requires the user to be logged in to LeetCode
  in the current Firefox profile.
- The extension has not been tested across every LeetCode language and UI
  variant.
- The icon artwork is inherited from upstream LeetHub and may be replaced before
  broader distribution.

## Project Status

This repository is prepared for public GitHub release and Mozilla AMO unlisted
self-distribution review. The extension version is defined in `manifest.json`.

## Credits

This project is derived from the open-source LeetHub project by Qasim Wani and
has been significantly modified for Firefox usage, Fine-Grained PAT
authentication, single-repository syncing, removal of broad GitHub OAuth
access, and manual historical Accepted solution sync.

This attribution does not imply endorsement by Qasim Wani or the LeetHub
maintainers.

## License

This project preserves the existing MIT license and required attribution. See
[LICENSE](LICENSE).
