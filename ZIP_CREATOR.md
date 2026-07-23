# SafeLeetSync ZIP Creator

## Terminal Commands

```powershell
Set-Location "D:\My Projects\LeetHub Personalized\leethub-personal"

$mainVersion = (Get-Content .\manifest.json -Raw | ConvertFrom-Json).version
$amoVersion = (Get-Content .\amo-package\manifest.json -Raw | ConvertFrom-Json).version
$packageVersion = (Get-Content .\package.json -Raw | ConvertFrom-Json).version

if ($mainVersion -ne $amoVersion -or $mainVersion -ne $packageVersion) {
  throw "Version mismatch: manifest=$mainVersion, amo=$amoVersion, package=$packageVersion"
}

Select-String -Path ".\scripts\background.js", ".\amo-package\scripts\background.js" `
  -Pattern "SafeLeetSync Auto Commit|LeetHub Auto Commit"

$version = $amoVersion
$zipPath = ".\safeleetsync-firefox-$version.zip"

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Compress-Archive -Path .\amo-package\* -DestinationPath $zipPath -Force
Write-Host "Created: $zipPath"

$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $zipPath))
$entries = @($archive.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
$archive.Dispose()

$requiredFiles = @(
  'manifest.json',
  'popup.html',
  'popup.js',
  'scripts/background.js',
  'scripts/leetcode.js',
  'scripts/leetcode-page-bridge.js'
)

$missingFiles = @($requiredFiles | Where-Object { $_ -notin $entries })
if ($missingFiles.Count -gt 0) {
  throw "Missing files in ZIP: $($missingFiles -join ', ')"
}

Write-Host "ZIP validation passed: $zipPath"
```

A successful run prints a variable archive name:

```text
ZIP validation passed: .\safeleetsync-firefox-*.*.*.zip
```

Keep the same version in:

- `manifest.json`
- `amo-package/manifest.json`
- `package.json`
- `package-lock.json`

The archive contains the files from `amo-package` directly at the ZIP root.

## Test Extension

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Select **This Firefox**.
3. Select **Load Temporary Add-on**.
4. Select `manifest.json` from the project root.
5. Open the SafeLeetSync popup.
6. Check or enter the GitHub owner, repository, and Fine-Grained PAT.
7. Select **Test GitHub Connection**.
8. Open a LeetCode problem and submit a solution.
9. Wait for an **Accepted** result.
10. Check GitHub for the updated solution and `README.md`.


## Update Extension in Firefox

1. Go to `https://addons.mozilla.org/en-US/developers/`
2. Open the SafeLeetSync add-on page.
3. Select **Upload New Version**.
4. Upload `safeleetsync-firefox-*.*.*.zip` from the project root.
5. Wait for AMO validation and resolve any reported errors.
6. Submit the new version for review or publication.

