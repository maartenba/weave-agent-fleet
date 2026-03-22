# Release Procedure

Use this checklist for every Fleet release. The goal is to ensure the tagged commit, the GitHub release, and the checked-in version metadata all match.

## Files that must match the release version

Update all of these before creating the release commit:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

The version string in those files must match the git tag, for example `v0.11.3` -> `0.11.3`.

## Release order

1. Pull the latest `main`.
2. Update all version files to the new version.
3. Review the diff and confirm only the intended release changes are included.
4. Commit the version bump on `main`.
5. Verify the committed files still contain the expected version values.
6. Create or move the release tag to that commit.
7. Push `main`.
8. Push the tag.
9. Create or verify the GitHub release for that tag.

Do not create the tag before the version bump commit exists.

## Recommended commands

```bash
git fetch origin main
git pull --ff-only origin main

# update version files

git diff -- package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: release vX.Y.Z"

git show --no-patch --decorate HEAD
git show HEAD:package.json
git show HEAD:package-lock.json
git show HEAD:src-tauri/tauri.conf.json
git show HEAD:src-tauri/Cargo.toml

git tag vX.Y.Z
git push origin main
git push origin refs/tags/vX.Y.Z

gh release create vX.Y.Z --generate-notes
```

## Dev channel publishing (push to `main`)

Dev channel packaging is automated by `.github/workflows/dev-channel.yml`.

- Trigger: every push to `main`
- Release tag namespace: `dev`
- Release type: prerelease (rolling)
- Updater metadata location: `releases/download/dev/latest.json`
- Package behavior: dev installers replace the normal app install (same app identity)

### Local channel-specific package builds

Use these scripts to produce channel-specific packages intentionally:

```bash
# stable package
bun run tauri:build:stable

# dev package (optionally override build id)
WEAVE_DEV_BUILD_ID=123 bun run tauri:build:dev
```

The prebuild script stamps both channel-specific updater endpoint and Tauri version before packaging.

## Required secrets for publishing

Both stable and dev workflows require:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `GITHUB_TOKEN` (provided by Actions runtime)

## Verification checklist

Before considering the release complete, verify all of the following:

- `git show vX.Y.Z:package.json` shows `"version": "X.Y.Z"`
- `git show vX.Y.Z:package-lock.json` shows `"version": "X.Y.Z"`
- `git show vX.Y.Z:src-tauri/tauri.conf.json` shows `"version": "X.Y.Z"`
- `git show vX.Y.Z:src-tauri/Cargo.toml` shows `version = "X.Y.Z"`
- `git ls-remote --tags origin refs/tags/vX.Y.Z` resolves to the intended commit
- `gh release view vX.Y.Z` succeeds

For dev channel publishes, also verify:

- `gh release view dev` succeeds
- Dev release contains platform installers for latest `main` build
- Dev release contains `latest.json` updater metadata
- Stable tagged release assets were not modified by dev publish

## If a tag or release was created too early

If the tag already exists but points to the wrong commit:

1. Create the corrective commit with the proper version files.
2. Move the local tag to the corrective commit.
3. Push `main`.
4. Delete the remote tag.
5. Push the corrected tag.
6. Re-check the GitHub release.

Example:

```bash
git tag -f vX.Y.Z HEAD
git push origin main
git push origin :refs/tags/vX.Y.Z
git push origin refs/tags/vX.Y.Z
gh release view vX.Y.Z
```

## Agent rule

Agents must not create or move a release tag until the version bump is committed and verified in the repository state that will be tagged.
