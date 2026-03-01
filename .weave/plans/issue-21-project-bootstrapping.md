# Project Bootstrapping: Init Command, Skill Installation, and Configuration UI

## TL;DR
> **Summary**: Add `weave-fleet init` and `weave-fleet skill install` CLI commands, plus a Fleet UI Settings/Configure page, to eliminate the ~30 min manual setup currently required per project. Leverages existing `skills.paths`, `weave-opencode.jsonc`, and project-level config override infrastructure.
> **Estimated Effort**: Large
> **Issue**: https://github.com/pgermishuys/weave-agent-fleet/issues/21

## Context

### Original Request
Users must currently hand-edit filesystem files to set up Weave + OpenCode for a new project:
- Clone the Agent Playbook repo to `~/.config/opencode/`
- Manually edit `weave-opencode.jsonc` for agent-skill mappings
- Manually place SKILL.md files in `~/.config/opencode/skills/{name}/`
- Create project-level `.opencode/weave-opencode.jsonc` overrides by hand

The goal is to provide a CLI `init` command, a `skill install` command, and a Fleet UI configuration page.

### Key Findings

**Architecture**:
- The fleet is a Next.js 16 app (standalone output mode) served by a bundled Node.js binary via launcher scripts (`scripts/launcher.sh` / `scripts/launcher.cmd`)
- The launcher currently handles: `start` (default), `version`, `update`, `uninstall`, `help`
- New CLI commands (`init`, `skill`) must either be handled in the launcher scripts OR delegate to the Node.js server. Since `init` and `skill install` need filesystem I/O, YAML parsing, and HTTP fetching — they should be **server-side API routes** with the launcher scripts acting as thin CLI wrappers that `curl` the API.
- **Alternative**: Since the fleet bundles Node.js at `$INSTALL_DIR/bin/node`, the launcher could run a standalone Node.js script (e.g., `$INSTALL_DIR/app/cli.js`) for CLI-only commands. This avoids requiring the server to be running. **This is the recommended approach** — `init` should work offline without a running server.

**Config structure**:
- User-level: `~/.config/opencode/weave-opencode.jsonc` — maps agents to skill names
- Project-level: `{project}/.opencode/weave-opencode.jsonc` — deep-merged with user-level
- Skills live at `~/.config/opencode/skills/{name}/SKILL.md` with YAML frontmatter (`name`, `description`)
- OpenCode config: `~/.config/opencode/opencode.json` — has `skills.paths` and `skills.urls` for additional skill sources

**Skill format** (existing standard):
```markdown
---
name: enforcing-csharp-standards
description: Enforces strict C# and .NET coding standards. Use when writing, editing, or generating C# code.
---

## Instructions
...
```

**Existing skills** (8 total): enforcing-csharp-standards, enforcing-dotnet-testing, fleet-orchestration, managing-pull-requests, processing-review-comments, reviewing-csharp-code, syncing-github-issues, verifying-release-builds

**UI navigation**: Sidebar already has a `/settings` link (placeholder — no page exists yet). This is the natural home for the configuration UI.

**Database**: SQLite via better-sqlite3. Currently stores workspaces, instances, sessions, notifications, callbacks. Config/skills are filesystem-based, not DB-based — and should stay that way (skills are git-tracked).

**Cross-platform**: Both `launcher.sh` (macOS/Linux) and `launcher.cmd` (Windows) exist and must be updated in parallel for any new CLI commands.

## Objectives

### Core Objective
Reduce project onboarding from ~30 min of manual filesystem editing to a single CLI command (for power users) or a few clicks in the UI (for visual users).

### Deliverables
- [ ] `weave-fleet init <directory>` CLI command with project detection and config generation
- [ ] `weave-fleet skill install <source>` CLI command to install skills from URLs/paths
- [ ] `weave-fleet skill list` CLI command to show installed skills
- [ ] Fleet UI Settings page with skill browser and agent-skill mapping editor
- [ ] API routes to back the UI operations (read/write config, list/install skills)

### Definition of Done
- [ ] `weave-fleet init /path/to/dotnet-project` creates `.opencode/weave-opencode.jsonc` with C#-appropriate skills
- [ ] `weave-fleet skill install https://raw.githubusercontent.com/.../SKILL.md` downloads and installs the skill
- [ ] `weave-fleet skill list` shows all installed skills with descriptions
- [ ] Settings page in the UI shows installed skills and allows toggling them per agent
- [ ] All tests pass: `npm run test`
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

### Guardrails (Must NOT)
- Must NOT require the server to be running for `init` and `skill install` (offline-first CLI)
- Must NOT change the skill format (SKILL.md with YAML frontmatter is the standard)
- Must NOT move skills into the database (they must remain git-trackable files)
- Must NOT break the existing Agent Playbook git repo structure at `~/.config/opencode/`
- Must NOT auto-commit or auto-push to the playbook repo
- Must NOT modify `opencode.json` without explicit user consent

## TODOs

---

### Phase 1: CLI Infrastructure + `weave-fleet init` (MVP)
*Goal*: A user can run one command to bootstrap a project with sensible defaults.

- [ ] 1. **Create CLI entry point script**
  **What**: Create a standalone Node.js CLI script (`scripts/cli.ts` → compiled to `cli.js`) that handles `init` and `skill` subcommands. This runs via the bundled Node.js binary without needing the server. The launcher scripts delegate to it for non-server commands.
  **Files**:
  - Create `src/cli/index.ts` — CLI entry point, parses subcommands (`init`, `skill`)
  - Create `src/cli/init.ts` — implements the `init` command
  - Create `src/cli/skill.ts` — implements skill subcommands (Phase 2)
  - Create `src/cli/config-paths.ts` — shared path resolution (user config dir, skills dir, project config dir)
  - Modify `package.json` — add `esbuild` as a devDependency and a `build:cli` script (e.g., `esbuild src/cli/index.ts --bundle --platform=node --outfile=cli.js`). **Note**: esbuild is a prerequisite for building the CLI — must be added in this task, not deferred.
  - Modify `scripts/assemble-standalone.sh` — copy `cli.js` into the standalone output
  - Modify `scripts/assemble-standalone.ps1` — same for Windows
  **Acceptance**: `node cli.js --help` prints usage. `node cli.js init --help` prints init-specific help.

- [ ] 2. **Update launcher scripts to delegate CLI commands**
  **What**: Add `init` and `skill` as recognized subcommands in both launcher scripts. Instead of starting the server, delegate to `$INSTALL_DIR/app/cli.js` using the bundled Node.js binary. **Important**: The current `server.js` existence guard runs before command dispatch — it must be moved inside the `start_server` branch only, otherwise `init` and `skill` will fail if the installation is partial or `server.js` doesn't exist yet.
  **Files**:
  - Modify `scripts/launcher.sh` — add `init)` and `skill)` cases that exec `$NODE_BIN $INSTALL_DIR/app/cli.js "$@"`
  - Modify `scripts/launcher.cmd` — add `:do_init` and `:do_skill` labels with same delegation
  **Acceptance**: `weave-fleet init /tmp/test` invokes the CLI script. `weave-fleet skill list` invokes the CLI script. Server commands still work.

- [ ] 3. **Implement project detection engine**
  **What**: Create a detection module that scans a directory for language/framework indicators and returns a structured profile. This is the intelligence behind `init`.
  **Files**:
  - Create `src/cli/detect-project.ts`
  **Detection heuristics** (ordered by specificity):
  | Indicator File(s) | Language/Framework | Suggested Skills |
  |---|---|---|
  | `*.csproj`, `*.sln`, `Directory.Build.props` | C# / .NET | `enforcing-csharp-standards`, `enforcing-dotnet-testing`, `reviewing-csharp-code`, `verifying-release-builds` |
  | `package.json` + `next.config.*` | TypeScript / Next.js | (no language-specific skills yet — but structure allows adding them) |
  | `package.json` + `tsconfig.json` | TypeScript / Node.js | (same) |
  | `package.json` | JavaScript / Node.js | (same) |
  | `go.mod` | Go | (same) |
  | `Cargo.toml` | Rust | (same) |
  | `pyproject.toml`, `setup.py`, `requirements.txt` | Python | (same) |
  | `.git/` | Git repository | `managing-pull-requests` (always include for git repos) |

  The detection function returns: `{ languages: string[], frameworks: string[], suggestedSkills: string[], isGitRepo: boolean }`.
  **Acceptance**: Unit test: given a directory with `*.csproj` and `.git/`, returns `{ languages: ["csharp"], frameworks: ["dotnet"], suggestedSkills: ["enforcing-csharp-standards", ...], isGitRepo: true }`.

- [ ] 4. **Implement `weave-fleet init <directory>`**
  **What**: The init command scans the project, resolves which skills are available (installed in `~/.config/opencode/skills/`), generates `.opencode/weave-opencode.jsonc`, and prints a summary.
  **Files**:
  - Modify `src/cli/init.ts`
  - Create `src/cli/skill-catalog.ts` — reads installed skills from `~/.config/opencode/skills/` by parsing SKILL.md frontmatter
  **Behavior**:
  1. Validate directory exists
  2. Check if `.opencode/weave-opencode.jsonc` already exists → warn and exit (unless `--force` flag)
  3. Run project detection
  4. Read installed skills from `~/.config/opencode/skills/`
  5. Intersect detected suggestions with installed skills
  6. Generate `.opencode/weave-opencode.jsonc` with default agent-skill mappings
  7. Print summary: "Detected: C# / .NET. Enabled skills: enforcing-csharp-standards, ..."
  8. Print next steps: "Run `weave-fleet` to start the dashboard, or `weave-fleet skill list` to see all available skills."
  **Flags**: `--force` (overwrite existing config), `--dry-run` (print what would be generated without writing)
  **Generated config format**:
  ```jsonc
  // Generated by weave-fleet init — customize as needed.
  // This is deep-merged with ~/.config/opencode/weave-opencode.jsonc
  {
    "agents": {
      "tapestry": {
        "skills": ["enforcing-csharp-standards", "enforcing-dotnet-testing", "verifying-release-builds"]
      },
      "shuttle": {
        "skills": ["enforcing-csharp-standards", "enforcing-dotnet-testing"]
      },
      "weft": {
        "skills": ["reviewing-csharp-code"]
      }
    }
  }
  ```
  **Acceptance**: `weave-fleet init /path/to/dotnet-project` creates `.opencode/weave-opencode.jsonc` with appropriate skills. `--dry-run` prints without writing.

- [ ] 5. **Write tests for project detection and init**
  **What**: Unit tests for the detection engine and integration test for the init command flow.
  **Files**:
  - Create `src/cli/__tests__/detect-project.test.ts`
  - Create `src/cli/__tests__/init.test.ts`
  **Test cases**:
  - Detection: C# project (has .csproj), Node.js project (has package.json + tsconfig.json), empty directory, multi-language project
  - Init: generates correct config, respects --force, respects --dry-run, errors on non-existent directory, warns when config already exists
  **Acceptance**: `npm run test` passes all new tests.

---

### Phase 2: `weave-fleet skill install` + `skill list`
*Goal*: Users can install skills from URLs and manage their skill catalog.

- [ ] 6. **Implement skill catalog reader**
  **What**: A module that reads all installed skills from `~/.config/opencode/skills/`, parses their YAML frontmatter, and returns a structured list.
  **Files**:
  - Modify `src/cli/skill-catalog.ts` (started in Phase 1, extend here)
  **Returns**: `Array<{ name: string, description: string, path: string, assignedAgents: string[] }>` — the `assignedAgents` comes from reading `weave-opencode.jsonc`.
  **Acceptance**: `listInstalledSkills()` returns all 8 existing skills with correct metadata.

- [ ] 7. **Implement `weave-fleet skill list`**
  **What**: Prints a formatted table of installed skills with their descriptions and agent assignments.
  **Files**:
  - Modify `src/cli/skill.ts`
  **Output format**:
  ```
  Installed Skills (8):
    enforcing-csharp-standards   Enforces strict C# and .NET coding standards   → tapestry, shuttle
    enforcing-dotnet-testing     Enforces .NET testing strategy and standards    → tapestry, shuttle
    ...
  ```
  **Acceptance**: `weave-fleet skill list` prints all installed skills.

- [ ] 8. **Implement `weave-fleet skill install <source>`**
  **What**: Downloads a SKILL.md from a URL (raw GitHub URL, or any HTTPS URL), saves it to `~/.config/opencode/skills/{name}/SKILL.md`, and optionally updates `weave-opencode.jsonc`.
  **Files**:
  - Modify `src/cli/skill.ts`
  - Create `src/cli/skill-installer.ts` — handles download, validation, and installation
  **Supported sources** (MVP):
  1. **Raw URL**: `https://raw.githubusercontent.com/user/repo/main/skills/my-skill/SKILL.md` → downloads and installs
  2. **GitHub repo path**: `github:user/repo/skills/my-skill` → resolves to raw URL and downloads (convenience shorthand)
  3. **Local path**: `/path/to/SKILL.md` → copies the file
  **Behavior**:
  1. Fetch/read the SKILL.md content
  2. Parse YAML frontmatter to extract `name` and `description` (validate both exist)
  3. Create `~/.config/opencode/skills/{name}/SKILL.md`
  4. Print: "Installed skill: {name} — {description}"
  5. Prompt/flag to add to agent mappings: `--agent tapestry,shuttle` → updates `weave-opencode.jsonc`
  **Flags**: `--agent <agents>` (comma-separated agent names to assign the skill to), `--force` (overwrite existing skill)
  **Acceptance**: `weave-fleet skill install https://example.com/SKILL.md --agent tapestry` downloads, installs, and maps the skill.

- [ ] 9. **Implement `weave-fleet skill remove <name>`**
  **What**: Removes an installed skill and its agent assignments.
  **Files**:
  - Modify `src/cli/skill.ts`
  **Behavior**:
  1. Check skill exists in `~/.config/opencode/skills/{name}/`
  2. Remove the directory
  3. Remove from all agent mappings in `weave-opencode.jsonc`
  4. Print confirmation
  **Acceptance**: `weave-fleet skill remove my-skill` removes the skill directory and cleans up config.

- [ ] 10. **Write tests for skill commands**
  **What**: Unit tests for skill installation, listing, and removal.
  **Files**:
  - Create `src/cli/__tests__/skill-catalog.test.ts`
  - Create `src/cli/__tests__/skill-installer.test.ts`
  **Test cases**:
  - List: reads skills from a test directory, merges agent assignments
  - Install from local path: copies SKILL.md, validates frontmatter
  - Install with --agent: updates weave-opencode.jsonc
  - Install invalid SKILL.md (missing frontmatter): errors gracefully
  - Remove: deletes directory, cleans config
  - Remove non-existent skill: errors gracefully
  **Acceptance**: `npm run test` passes all new tests.

---

### Phase 3: Configuration API Routes
*Goal*: Server-side API endpoints that the Fleet UI can call to read/write config.

- [ ] 11. **Create config reader/writer server module**
  **What**: Server-side module that reads and writes `weave-opencode.jsonc` (both user-level and project-level). Also reads installed skills. Reuses logic from the CLI modules but adapted for the server context.
  **Files**:
  - Create `src/lib/server/config-manager.ts` — reads/writes weave-opencode.jsonc, lists skills
  **API**:
  - `getUserConfig()` → parsed user-level `weave-opencode.jsonc`
  - `getProjectConfig(directory: string)` → parsed project-level `.opencode/weave-opencode.jsonc`
  - `getMergedConfig(directory: string)` → deep-merged result
  - `updateUserConfig(config: WeaveConfig)` → writes user-level config
  - `updateProjectConfig(directory: string, config: WeaveConfig)` → writes project-level config
  - `listInstalledSkills()` → array of `{ name, description, path }`
  **Acceptance**: `getUserConfig()` returns the current config object. `listInstalledSkills()` returns all 8 skills.

- [ ] 12. **Create API route: GET/PUT /api/config**
  **What**: REST endpoints for reading and writing the user-level Weave config.
  **Files**:
  - Create `src/app/api/config/route.ts`
  **Endpoints**:
  - `GET /api/config` → returns `{ userConfig, installedSkills }` — the user-level config and all installed skills
  - `PUT /api/config` → accepts `{ agents: { ... } }` and writes to `~/.config/opencode/weave-opencode.jsonc`
  **Acceptance**: `curl localhost:3000/api/config` returns the current config. `curl -X PUT` updates it.

- [ ] 13. **Create API route: GET/POST/DELETE /api/skills**
  **What**: REST endpoints for managing skills.
  **Files**:
  - Create `src/app/api/skills/route.ts`
  - Create `src/app/api/skills/[name]/route.ts`
  **Endpoints**:
  - `GET /api/skills` → list all installed skills with metadata and agent assignments
  - `POST /api/skills` → install a skill from URL/content (body: `{ url?: string, content?: string, agents?: string[] }`)
  - `DELETE /api/skills/[name]` → remove a skill
  **Acceptance**: API tests pass. CRUD operations work.

- [ ] 14. **Write tests for API routes**
  **What**: Unit/integration tests for config and skills API routes.
  **Files**:
  - Create `src/app/api/config/__tests__/route.test.ts`
  - Create `src/app/api/skills/__tests__/route.test.ts`
  **Acceptance**: `npm run test` passes all new tests.

---

### Phase 4: Fleet UI Settings Page
*Goal*: Visual skill browser and agent-skill mapping editor in the Fleet dashboard.

- [ ] 15. **Create the Settings page layout**
  **What**: New page at `/settings` with tabs: "Skills", "Agents", "About". Uses the existing layout pattern from other pages (`Header` component, sidebar navigation already links to `/settings`).
  **Files**:
  - Create `src/app/settings/page.tsx` — page shell with tabs
  **Acceptance**: Navigating to `/settings` in the Fleet UI shows a tabbed settings page.

- [ ] 16. **Create React hooks for config and skills**
  **What**: Client-side hooks that fetch from the API routes created in Phase 3.
  **Files**:
  - Create `src/hooks/use-config.ts` — `useConfig()` hook that fetches `GET /api/config`, provides `updateConfig()`
  - Create `src/hooks/use-skills.ts` — `useSkills()` hook that fetches `GET /api/skills`, provides `installSkill()`, `removeSkill()`
  **Acceptance**: Hooks fetch and return data. Mutations trigger refetch.

- [ ] 17. **Build Skills tab — installed skills browser**
  **What**: A list/grid of installed skills showing name, description, and which agents they're assigned to. Each skill card has a toggle per agent (tapestry, shuttle, loom, weft, etc.) to assign/unassign.
  **Files**:
  - Create `src/components/settings/skills-tab.tsx` — main skills list
  - Create `src/components/settings/skill-card.tsx` — individual skill card with agent toggles
  **UI design**:
  - Each skill is a card with: name, description, file path
  - Below the description: a row of agent badges — toggling one adds/removes the skill from that agent in `weave-opencode.jsonc` via the API
  - "Install Skill" button → opens a dialog to paste a URL or upload a SKILL.md
  - "Remove" button per skill (with confirmation)
  **Acceptance**: Skills tab shows all installed skills. Toggling an agent badge updates the config. Install button works.

- [ ] 18. **Build Agents tab — agent-skill mapping overview**
  **What**: An agent-centric view that shows each agent and its assigned skills. The inverse of the Skills tab. **Note**: Agent list must be read dynamically from `weave-opencode.jsonc` — do not hardcode agent names, as the set of agents varies between configurations.
  **Files**:
  - Create `src/components/settings/agents-tab.tsx`
  **UI design**:
  - One section per agent (read dynamically from config — currently: loom, tapestry, shuttle, weft)
  - Each section shows the agent name + list of assigned skills
  - Drag-and-drop or add/remove buttons to modify assignments
  - Clear visual distinction between user-level and project-level config
  **Acceptance**: Agents tab shows all agents with their skill assignments.

- [ ] 19. **Build Install Skill dialog**
  **What**: A dialog/sheet (like the existing `new-session-dialog.tsx` pattern) for installing a skill from a URL.
  **Files**:
  - Create `src/components/settings/install-skill-dialog.tsx`
  **UI**:
  - URL input field
  - "Install" button → calls `POST /api/skills`
  - Shows loading state, then success/error
  - On success, refreshes the skills list
  **Acceptance**: User can paste a raw SKILL.md URL and install it from the UI.

- [ ] 20. **Build About tab — version and config info**
  **What**: Shows version info (already available via `GET /api/version`), config file locations, and links to docs.
  **Files**:
  - Create `src/components/settings/about-tab.tsx`
  **Shows**:
  - Weave Fleet version (with update available indicator)
  - OpenCode version
  - Config file paths: `~/.config/opencode/weave-opencode.jsonc`, skills directory
  - Link to documentation
  **Acceptance**: About tab shows accurate version and path info.

---

### Phase 5: Polish and Integration
*Goal*: End-to-end experience refinement.

- [ ] 21. **Add help text for new CLI commands**
  **What**: Update the help output in both launcher scripts to include `init` and `skill` commands.
  **Files**:
  - Modify `scripts/launcher.sh` — update help text
  - Modify `scripts/launcher.cmd` — update help text
  **Acceptance**: `weave-fleet help` shows init and skill commands.

- [ ] 22. **Add help text and finalize CLI polish**
  **What**: Update help output in launcher scripts and verify end-to-end CLI experience.
  **Files**:
  - Modify `scripts/launcher.sh` — update help text (merge with Task 21)
  - Modify `scripts/launcher.cmd` — update help text
  **Acceptance**: `weave-fleet help` shows init and skill commands with descriptions.

- [ ] 23. **E2E smoke test**
  **What**: A simple end-to-end test that runs `init` on a test directory and verifies the output.
  **Files**:
  - Create `src/cli/__tests__/e2e.test.ts`
  **Test**:
  1. Create a temp directory with a `.csproj` file and `.git/`
  2. Run `init` on it
  3. Verify `.opencode/weave-opencode.jsonc` was created with expected content
  4. Run `skill list` and verify output
  **Acceptance**: E2E test passes.

---

## Architecture Decisions

### CLI as standalone Node.js script (not server-dependent)
The `init` and `skill` commands must work without the Fleet server running. Users may want to bootstrap a project before ever starting the dashboard. The bundled Node.js binary at `$INSTALL_DIR/bin/node` already exists — we compile a `cli.js` with esbuild and the launcher delegates to it.

### Filesystem-based config (not database)
Skills and config remain as files in `~/.config/opencode/` — they're git-tracked in the Agent Playbook repo. The database is only for runtime state (instances, sessions, notifications). This preserves team sharing via `git pull`.

### JSONC format with comments
The generated `.opencode/weave-opencode.jsonc` should include comments explaining the format, since users will likely hand-edit it. JSON5/JSONC is already the established format.

### Project-level config only from `init`
The `init` command generates project-level config (`.opencode/weave-opencode.jsonc`), not user-level. This means project-specific skill selections are committed with the project and shared with the team. The user-level config at `~/.config/opencode/weave-opencode.jsonc` is managed separately (via `skill install` or the UI).

### Detection is heuristic, not exhaustive
The project detection engine uses simple file-existence checks (does `*.csproj` exist?). It doesn't analyze file contents or parse build configs. This keeps it fast and reliable. Users can always hand-edit the generated config.

## Potential Pitfalls

| Risk | Mitigation |
|---|---|
| YAML frontmatter parsing requires a YAML library | Use a minimal parser — frontmatter is just `key: value` lines between `---` fences. No need for a full YAML library. Or add `yaml` as a dependency (tiny, well-maintained). |
| JSONC writing (preserving comments) is tricky | For generated files, write with template strings. For updating existing files, parse with a JSONC parser (strip comments), modify, and re-serialize — acknowledge comments may be lost on round-trip. Warn the user. |
| CLI needs esbuild or similar for standalone bundling | Added as devDependency in Phase 1, Task 1. The build is a single-file bundle — minimal config needed. |
| Cross-platform path handling in CLI | Use `path.resolve()`, `os.homedir()`, and `path.sep` consistently. Test on both macOS and Windows path styles. |
| `skill install` from untrusted URLs | Skills are just markdown — they can't execute code directly. But they influence agent behavior. Add a warning when installing from non-verified sources. |
| Concurrent config writes (UI + CLI simultaneously) | Unlikely in practice. Use atomic file writes (write to temp file, then rename) for safety. |

## Verification
- [ ] All tests pass: `npm run test`
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] Production build succeeds: `npm run build`
- [ ] `weave-fleet init` works on a sample C# project directory
- [ ] `weave-fleet skill list` shows installed skills
- [ ] `weave-fleet skill install` from a URL works
- [ ] Settings page loads in the Fleet UI at `/settings`
- [ ] Skills can be toggled per agent in the UI
- [ ] No regressions in existing session management, launcher, or fleet features
