# TASK: Install the Google Cloud CLI on this Mac (no repo changes)

CONTEXT: Erik asked to set up the Chrome Web Store API so releases upload and submit from this Mac. The release script will use `gcloud auth print-access-token --impersonate-service-account=... --scopes=https://www.googleapis.com/auth/chromewebstore`.

SCOPE (~5 min):
1. If `gcloud` is already on PATH, report its version and stop.
2. Otherwise run `brew install --cask gcloud-cli`. If that cask name is not found, run `brew search gcloud` / `brew search google-cloud` and install the official Google Cloud SDK cask it shows.
3. Report `gcloud version` and the absolute path of the gcloud binary.

EXCLUDES:
- Do NOT run `gcloud auth login` or any sign-in (Erik does that himself).
- No git changes, no commits, no branches.
- Do not edit shell rc files beyond what the cask installer itself does.

ACCEPTANCE:
- [ ] `gcloud version` prints a version
- [ ] Result reports the binary path
