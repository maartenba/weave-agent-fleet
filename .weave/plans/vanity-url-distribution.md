# Vanity URL Distribution for Install Scripts

## TL;DR
> **Summary**: Set up `get.tryweave.io/agent-fleet.sh` and `get.tryweave.io/agent-fleet.ps1` as vanity URLs for the Weave Agent Fleet install scripts, using GitHub Pages as the serving layer with DNSimple CNAME records and automated deployment via GitHub Actions.
> **Estimated Effort**: Short

## Context

### Original Request
Create memorable vanity URLs for the install scripts so users can run:
```sh
curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh        # macOS/Linux
irm https://get.tryweave.io/agent-fleet.ps1 | iex              # Windows
```
Instead of the current long GitHub Releases URLs.

### Key Findings

1. **Current install URL** — `curl -fsSL https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh | sh`. This URL is referenced in:
   - `README.md` line 14 (install instructions)
   - `scripts/install.sh` line 3 (usage comment header)
   - `scripts/launcher.sh` lines 16, 24 (corruption error messages)
   - `scripts/launcher.sh` line 41 (update subcommand — downloads `install.sh` from GitHub Releases)

2. **Self-referencing URLs in scripts** — `launcher.sh` has the GitHub Releases URL hardcoded for the `update` subcommand (line 41) and for "corrupt install" error messages (lines 16, 24). These must be updated to use the vanity URL so updates flow through the same stable endpoint.

3. **Windows plan** — `.weave/plans/windows-installer-support.md` references `install.ps1` download URLs in tasks 1, 2, and 11. The Definition of Done (line 58) uses the raw GitHub Releases URL. These should all use the vanity URL.

4. **`install.sh` is attached to GitHub Releases** — The release workflow (`.github/workflows/release.yml` line 140) uploads `scripts/install.sh` as a release asset. The vanity URL can either serve the script directly (copied to gh-pages) or redirect to this release asset.

5. **DNS is on DNSimple** — The `tryweave.io` domain is managed via DNSimple. DNSimple supports CNAME records, ALIAS records, and URL redirects. A CNAME pointing `get.tryweave.io` to GitHub Pages is straightforward.

6. **Script naming mismatch** — Source files are `scripts/install.sh` and `scripts/install.ps1` but vanity URLs serve them as `agent-fleet.sh` and `agent-fleet.ps1`. This requires either a copy/rename step in the deploy process or redirect rules.

### Approach Evaluation

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A: GitHub Pages** | Free, same platform, HTTPS included, static file serving, no external service | Requires deploy step to copy scripts | **Recommended** |
| **B: Cloudflare Workers** | Flexible, can proxy/redirect, 100k req/day free | Adds a service dependency, DNS must go through Cloudflare or add CNAME | Overkill |
| **C: DNSimple URL Redirect** | Simplest — no hosting at all | May not support path-level redirects (`/agent-fleet.sh` → specific URL), redirect changes the URL in the user's terminal (cosmetic), cost per redirect | Too limited |
| **D: Netlify/Vercel** | Redirect rules, easy custom domains | Adds external service, account management | Unnecessary |

### Architecture Decision: GitHub Pages with Direct Serving

Use a `gh-pages` branch in the same repo (`pgermishuys/weave-agent-fleet`) to serve scripts directly (not redirect). This means:
- `get.tryweave.io/agent-fleet.sh` serves the actual script content with `Content-Type: application/x-sh`
- The user's `curl` downloads the script directly — no redirect, no intermediate service
- A GitHub Actions workflow copies `scripts/install.sh` → `agent-fleet.sh` (and `install.ps1` → `agent-fleet.ps1`) to the `gh-pages` branch on every release
- GitHub Pages provides free HTTPS via Let's Encrypt for custom domains

## Objectives

### Core Objective
Serve install scripts at `https://get.tryweave.io/agent-fleet.sh` and `https://get.tryweave.io/agent-fleet.ps1` with zero ongoing maintenance, updating automatically on each release.

### Deliverables
- [ ] DNSimple CNAME record for `get.tryweave.io`
- [ ] GitHub Pages configuration on `gh-pages` branch
- [ ] GitHub Actions workflow to deploy scripts to `gh-pages` on release
- [ ] Updated install/launcher scripts to use vanity URLs
- [ ] Updated README with vanity URL install commands
- [ ] Updated Windows plan with vanity URL references

### Definition of Done
- [ ] `curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh` downloads and runs the install script
- [ ] `curl -fsSL https://get.tryweave.io/agent-fleet.sh` returns the script content (not a redirect)
- [ ] HTTPS works with a valid certificate on `get.tryweave.io`
- [ ] Publishing a new release automatically updates the scripts at the vanity URL
- [ ] All references in the codebase use the vanity URL

### Guardrails (Must NOT)
- Must NOT break the existing GitHub Releases download URLs (keep as fallback)
- Must NOT require any paid service or external account beyond DNSimple + GitHub
- Must NOT redirect — serve scripts directly so `curl` output is clean
- Must NOT disrupt the existing release workflow for tarballs/checksums

## TODOs

### Phase 1: DNS & GitHub Pages Setup (Manual)

- [ ] 1. **Create CNAME record in DNSimple**
  **What**: Add a CNAME record in DNSimple for the `get` subdomain of `tryweave.io`:
  ```
  Type:  CNAME
  Name:  get
  Value: pgermishuys.github.io
  TTL:   3600 (1 hour)
  ```
  This points `get.tryweave.io` to GitHub Pages. GitHub Pages will handle the domain verification and TLS certificate.
  **Files**: None (DNS console)
  **Acceptance**: `dig get.tryweave.io CNAME` returns `pgermishuys.github.io.`

- [ ] 2. **Initialize the `gh-pages` branch with CNAME file**
  **What**: Create an orphan `gh-pages` branch with:
  - `CNAME` file containing `get.tryweave.io` (tells GitHub Pages to serve this custom domain)
  - `.nojekyll` empty file (disables Jekyll processing — we want raw file serving)
  - `agent-fleet.sh` — copy of `scripts/install.sh`
  - `index.html` — minimal landing page (optional, for browser visitors):
    ```html
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Weave Agent Fleet</title></head>
    <body>
    <h1>Weave Agent Fleet</h1>
    <p>Install: <code>curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh</code></p>
    <p><a href="https://github.com/pgermishuys/weave-agent-fleet">GitHub</a></p>
    </body>
    </html>
    ```
  
  Commands to run:
  ```sh
  git checkout --orphan gh-pages
  git rm -rf .
  echo "get.tryweave.io" > CNAME
  touch .nojekyll
  cp scripts/install.sh agent-fleet.sh
  # Create index.html
  git add CNAME .nojekyll agent-fleet.sh index.html
  git commit -m "Initialize gh-pages for vanity URL distribution"
  git push origin gh-pages
  git checkout main
  ```
  **Files**: `gh-pages` branch: `CNAME`, `.nojekyll`, `agent-fleet.sh`, `index.html`
  **Acceptance**: Branch `gh-pages` exists on GitHub with the files.

- [ ] 3. **Enable GitHub Pages in repo settings**
  **What**: In the GitHub repo settings (`Settings > Pages`):
  - Source: Deploy from a branch
  - Branch: `gh-pages` / `/ (root)`
  - Custom domain: `get.tryweave.io`
  - Enforce HTTPS: ✅ (enable after DNS propagation — GitHub auto-provisions a Let's Encrypt cert)
  
  GitHub will verify the CNAME record and provision a TLS certificate. This may take up to 24 hours for initial certificate issuance, but typically completes in minutes.
  **Files**: None (GitHub UI)
  **Acceptance**: `https://get.tryweave.io/agent-fleet.sh` returns the script content. The GitHub Pages settings show "Your site is published at https://get.tryweave.io/".

### Phase 2: Automated Deployment

- [ ] 4. **Add deploy-to-gh-pages step in release workflow**
  **What**: Add a new job to `.github/workflows/release.yml` that runs after the `release` job and copies the install scripts to the `gh-pages` branch. This ensures the vanity URL always serves the latest release's scripts.

  Add a `deploy-vanity-url` job:
  ```yaml
  deploy-vanity-url:
    needs: release
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: gh-pages
          path: gh-pages

      - uses: actions/checkout@v4
        with:
          ref: ${{ github.ref }}
          path: source

      - name: Update scripts on gh-pages
        run: |
          cp source/scripts/install.sh gh-pages/agent-fleet.sh
          if [ -f source/scripts/install.ps1 ]; then
            cp source/scripts/install.ps1 gh-pages/agent-fleet.ps1
          fi

      - name: Commit and push
        working-directory: gh-pages
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add agent-fleet.sh agent-fleet.ps1 2>/dev/null || true
          if git diff --cached --quiet; then
            echo "No changes to deploy"
          else
            git commit -m "Update install scripts for ${GITHUB_REF_NAME}"
            git push
          fi
  ```
  **Files**: `.github/workflows/release.yml`
  **Acceptance**: After a release tag push, the `gh-pages` branch is updated with the latest `agent-fleet.sh` (and `agent-fleet.ps1` if it exists). The vanity URL serves the updated script.

### Phase 3: Update References in Scripts

- [ ] 5. **Update `scripts/install.sh` header comment**
  **What**: Change the usage comment from the GitHub Releases URL to the vanity URL:
  ```sh
  # Usage: curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh
  ```
  Keep the `REPO` variable and all GitHub API/download URLs unchanged — those point to GitHub Releases for the actual tarballs, not the install script itself.
  **Files**: `scripts/install.sh` (line 3)
  **Acceptance**: The comment at the top of `install.sh` shows the vanity URL.

- [ ] 6. **Update `scripts/launcher.sh` error messages and update URL**
  **What**: Update three locations where the GitHub Releases `install.sh` URL is hardcoded:
  
  Line 16 (Node.js binary not found error):
  ```sh
  echo "  curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh" >&2
  ```
  
  Line 24 (server.js not found error):
  ```sh
  echo "  curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh" >&2
  ```
  
  Line 41 (update subcommand):
  ```sh
  exec sh -c "curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh"
  ```
  
  Line 43 (wget fallback for update):
  ```sh
  exec sh -c "wget -qO- https://get.tryweave.io/agent-fleet.sh | sh"
  ```
  **Files**: `scripts/launcher.sh` (lines 16, 24, 41, 43)
  **Acceptance**: All self-referencing URLs in the launcher use the vanity URL. `weave-fleet update` downloads from `get.tryweave.io`.

- [ ] 7. **Update `README.md` install instructions**
  **What**: Replace the install command with the vanity URL:
  ```markdown
  ### Install

  **macOS / Linux:**
  ```sh
  curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh
  ```
  ```
  Keep the existing sections (Run, Update, Uninstall, Configuration) unchanged.
  **Files**: `README.md` (line 14)
  **Acceptance**: README shows the vanity URL for installation.

### Phase 4: Update Windows Plan

- [ ] 8. **Update `windows-installer-support.md` with vanity URLs**
  **What**: Update all references to the raw GitHub Releases URLs in the Windows plan to use vanity URLs:
  
  - Line 58 (Definition of Done): `irm https://get.tryweave.io/agent-fleet.ps1 | iex`
  - Line 80 (Task 1 description): `irm https://get.tryweave.io/agent-fleet.ps1 | iex`
  - Line 96 (Task 1 acceptance): `irm <url> | iex` → clarify URL is the vanity URL
  - Line 101-103 (Task 2 — install.sh Windows redirect message):
    ```
    irm https://get.tryweave.io/agent-fleet.ps1 | iex
    ```
  - Lines 120-121 (Task 3 — launcher.cmd update subcommand):
    ```cmd
    powershell -NoProfile -Command "irm https://get.tryweave.io/agent-fleet.ps1 | iex"
    ```
  - Lines 256-260 (Task 11 — README Windows instructions):
    ```powershell
    irm https://get.tryweave.io/agent-fleet.ps1 | iex
    ```
  - Line 354 (Verification): Update `irm <install.ps1 URL> | iex` → `irm https://get.tryweave.io/agent-fleet.ps1 | iex`
  
  **Files**: `.weave/plans/windows-installer-support.md`
  **Acceptance**: All install URLs in the Windows plan use `get.tryweave.io` vanity URLs.

- [ ] 9. **Add vanity URL note to the Windows install.ps1 task**
  **What**: When `scripts/install.ps1` is eventually implemented (per the Windows plan), ensure it includes the vanity URL in its header comment:
  ```powershell
  # Usage: irm https://get.tryweave.io/agent-fleet.ps1 | iex
  ```
  This is a note for the Windows plan implementer — no file changes now since `install.ps1` doesn't exist yet.
  **Files**: None (documentation note in the Windows plan)
  **Acceptance**: The Windows plan's Task 1 mentions using the vanity URL in the script header.

## Implementation Order

```
Phase 1 (Tasks 1-3): DNS + GitHub Pages     ← Manual setup, must be done first
    ↓
Phase 2 (Task 4): Automation                ← Depends on gh-pages branch existing
    ↓
Phase 3 (Tasks 5-7): Update references      ← Independent of Phases 1-2 (can be done in parallel)
    ↓
Phase 4 (Tasks 8-9): Windows plan updates   ← Independent, can parallelize with Phase 3
```

Tasks 5, 6, and 7 are independent of each other. Tasks 8 and 9 are independent of tasks 5-7. All of Phase 3 and Phase 4 can be done in parallel.

Phase 1 is manual (DNS + GitHub settings) and must complete before Phase 2 automation can be verified. However, the code changes in Phases 3-4 can be committed before DNS propagates — they'll just reference the new URL that will work once setup completes.

## Potential Pitfalls & Mitigations

### 1. DNS propagation delay
**Risk**: After adding the CNAME in DNSimple, it may take minutes to hours for DNS to propagate globally. During this window, `get.tryweave.io` won't resolve.
**Mitigation**: Keep the old GitHub Releases URLs as a documented fallback in the README (in a collapsible "Alternative install" section). GitHub Pages will also continue serving at `pgermishuys.github.io/weave-agent-fleet/` as a fallback.

### 2. GitHub Pages TLS certificate delay
**Risk**: GitHub Pages takes time to provision a Let's Encrypt certificate for custom domains. Until the cert is issued, HTTPS won't work (and `curl -fsSL` will fail on certificate errors).
**Mitigation**: Wait for the certificate to be issued before updating the scripts/README to use the vanity URL. GitHub Pages settings page shows certificate status. Typically takes 15 minutes, can take up to 24 hours. Don't enforce HTTPS until the cert is ready.

### 3. CNAME conflict with apex domain
**Risk**: `get.tryweave.io` is a subdomain, not the apex (`tryweave.io`). CNAME records on subdomains are standard and have no conflicts. This is a non-issue.
**Mitigation**: None needed — standard CNAME on a subdomain.

### 4. GitHub Pages serves with wrong Content-Type
**Risk**: GitHub Pages may serve `.sh` files as `text/plain` or `application/octet-stream` instead of `application/x-sh`. This is actually fine for `curl | sh` — `curl` doesn't care about Content-Type, and `sh` reads stdin regardless.
**Mitigation**: None needed. `curl -fsSL` and `irm` both work regardless of Content-Type. The `.nojekyll` file ensures GitHub Pages serves files as-is without processing.

### 5. gh-pages branch conflicts
**Risk**: If someone manually edits the `gh-pages` branch, the automated deploy could have merge conflicts.
**Mitigation**: The deploy job checks out the latest `gh-pages` branch, copies files, and force-commits. Since only the automation writes to this branch, conflicts are unlikely. Add a note in the branch's README/CNAME that this branch is auto-managed.

### 6. Script divergence between release asset and vanity URL
**Risk**: The install script attached to a GitHub Release (as a release asset) and the one served at the vanity URL could diverge if the automation fails silently.
**Mitigation**: The `deploy-vanity-url` job copies directly from the tagged source code (`scripts/install.sh`), the same source that gets attached to the release. Both come from the same commit. The GitHub Actions workflow will show failures if the deploy step errors.

### 7. Breaking existing install commands
**Risk**: Users who bookmarked or scripted the old GitHub Releases URL will break if we remove it.
**Mitigation**: We are NOT removing the old URL. GitHub Releases will continue to serve `install.sh` as a release asset. The vanity URL is an addition, not a replacement. Only the documented/recommended URL changes.

## Verification
- [ ] `dig get.tryweave.io CNAME` returns `pgermishuys.github.io.`
- [ ] `curl -I https://get.tryweave.io/agent-fleet.sh` returns HTTP 200 with valid TLS
- [ ] `curl -fsSL https://get.tryweave.io/agent-fleet.sh | head -1` outputs `#!/usr/bin/env sh`
- [ ] `curl -fsSL https://get.tryweave.io/agent-fleet.sh | sh` installs Weave Fleet successfully
- [ ] After publishing a new release, `curl -fsSL https://get.tryweave.io/agent-fleet.sh` returns the updated script within 5 minutes
- [ ] `https://get.tryweave.io/` in a browser shows the landing page (not a 404)
- [ ] Old GitHub Releases URL (`https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.sh`) still works
- [ ] `scripts/launcher.sh` `update` subcommand uses vanity URL
- [ ] `README.md` shows vanity URL in install instructions
- [ ] All references in `windows-installer-support.md` use vanity URLs
