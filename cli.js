#!/usr/bin/env node
"use strict";

// src/cli/init.ts
var import_fs3 = require("fs");
var import_path4 = require("path");

// src/cli/detect-project.ts
var import_fs = require("fs");
var import_path = require("path");
var DETECTION_RULES = [
  {
    indicators: [
      { type: "extension", pattern: ".csproj" },
      { type: "extension", pattern: ".sln" },
      { type: "file", pattern: "Directory.Build.props" }
    ],
    language: "csharp",
    framework: "dotnet",
    skills: [
      "enforcing-csharp-standards",
      "enforcing-dotnet-testing",
      "reviewing-csharp-code",
      "verifying-release-builds"
    ]
  },
  {
    indicators: [
      { type: "file", pattern: "next.config.js" },
      { type: "file", pattern: "next.config.ts" },
      { type: "file", pattern: "next.config.mjs" }
    ],
    language: "typescript",
    framework: "nextjs",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "tsconfig.json" }],
    language: "typescript",
    framework: "nodejs",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "package.json" }],
    language: "javascript",
    framework: "nodejs",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "go.mod" }],
    language: "go",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "Cargo.toml" }],
    language: "rust",
    skills: []
  },
  {
    indicators: [
      { type: "file", pattern: "pyproject.toml" },
      { type: "file", pattern: "setup.py" },
      { type: "file", pattern: "requirements.txt" }
    ],
    language: "python",
    skills: []
  }
];
function matchesIndicator(dirEntries, indicator, directory) {
  switch (indicator.type) {
    case "file":
      return dirEntries.includes(indicator.pattern);
    case "extension":
      return dirEntries.some((entry) => entry.endsWith(indicator.pattern));
    case "directory": {
      const dirPath = (0, import_path.join)(directory, indicator.pattern);
      return (0, import_fs.existsSync)(dirPath) && (0, import_fs.statSync)(dirPath).isDirectory();
    }
  }
}
function detectProject(directory) {
  if (!(0, import_fs.existsSync)(directory)) {
    throw new Error(`Directory does not exist: ${directory}`);
  }
  if (!(0, import_fs.statSync)(directory).isDirectory()) {
    throw new Error(`Not a directory: ${directory}`);
  }
  const entries = (0, import_fs.readdirSync)(directory);
  const languages = /* @__PURE__ */ new Set();
  const frameworks = /* @__PURE__ */ new Set();
  const suggestedSkills = /* @__PURE__ */ new Set();
  const isGitRepo = (0, import_fs.existsSync)((0, import_path.join)(directory, ".git")) && (0, import_fs.statSync)((0, import_path.join)(directory, ".git")).isDirectory();
  if (isGitRepo) {
    suggestedSkills.add("managing-pull-requests");
  }
  for (const rule of DETECTION_RULES) {
    const matched = rule.indicators.some(
      (indicator) => matchesIndicator(entries, indicator, directory)
    );
    if (matched) {
      languages.add(rule.language);
      if (rule.framework) {
        frameworks.add(rule.framework);
      }
      for (const skill of rule.skills) {
        suggestedSkills.add(skill);
      }
    }
  }
  return {
    languages: Array.from(languages),
    frameworks: Array.from(frameworks),
    suggestedSkills: Array.from(suggestedSkills),
    isGitRepo
  };
}

// src/cli/skill-catalog.ts
var import_fs2 = require("fs");
var import_path3 = require("path");

// src/cli/config-paths.ts
var import_os = require("os");
var import_path2 = require("path");
function getUserConfigDir() {
  return (0, import_path2.join)((0, import_os.homedir)(), ".config", "opencode");
}
function getUserWeaveConfigPath() {
  return (0, import_path2.join)(getUserConfigDir(), "weave-opencode.jsonc");
}
function getSkillsDir() {
  return (0, import_path2.join)(getUserConfigDir(), "skills");
}
function getProjectConfigDir(projectDir) {
  return (0, import_path2.join)(projectDir, ".opencode");
}
function getProjectWeaveConfigPath(projectDir) {
  return (0, import_path2.join)(getProjectConfigDir(projectDir), "weave-opencode.jsonc");
}

// src/cli/skill-catalog.ts
function parseFrontmatter(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return null;
  }
  let name = "";
  let description = "";
  let foundEnd = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---") {
      foundEnd = true;
      break;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "name") {
      name = value;
    } else if (key === "description") {
      description = value;
    }
  }
  if (!foundEnd || !name) {
    return null;
  }
  return { name, description };
}
function parseJsonc(content) {
  let cleaned = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let i = 0;
  while (i < content.length) {
    if (inSingleLineComment) {
      if (content[i] === "\n") {
        inSingleLineComment = false;
        cleaned += "\n";
      }
      i++;
      continue;
    }
    if (inMultiLineComment) {
      if (content[i] === "*" && content[i + 1] === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (content[i] === "\n") {
        cleaned += "\n";
      }
      i++;
      continue;
    }
    if (inString) {
      if (content[i] === "\\" && i + 1 < content.length) {
        cleaned += content[i] + content[i + 1];
        i += 2;
        continue;
      }
      if (content[i] === '"') {
        inString = false;
      }
      cleaned += content[i];
      i++;
      continue;
    }
    if (content[i] === '"') {
      inString = true;
      cleaned += content[i];
      i++;
      continue;
    }
    if (content[i] === "/" && content[i + 1] === "/") {
      inSingleLineComment = true;
      i += 2;
      continue;
    }
    if (content[i] === "/" && content[i + 1] === "*") {
      inMultiLineComment = true;
      i += 2;
      continue;
    }
    cleaned += content[i];
    i++;
  }
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
  return JSON.parse(cleaned);
}
function readWeaveConfig(configPath) {
  if (!(0, import_fs2.existsSync)(configPath)) {
    return null;
  }
  try {
    const content = (0, import_fs2.readFileSync)(configPath, "utf-8");
    return parseJsonc(content);
  } catch {
    return null;
  }
}
function getAgentAssignments(config, skillName) {
  if (!config?.agents) return [];
  const agents = [];
  for (const [agentName, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.skills?.includes(skillName)) {
      agents.push(agentName);
    }
  }
  return agents;
}
function listInstalledSkills(skillsDir, configPath) {
  const dir = skillsDir ?? getSkillsDir();
  const cfgPath = configPath ?? getUserWeaveConfigPath();
  if (!(0, import_fs2.existsSync)(dir)) {
    return [];
  }
  const config = readWeaveConfig(cfgPath);
  const skills = [];
  const entries = (0, import_fs2.readdirSync)(dir);
  for (const entry of entries) {
    const skillDir = (0, import_path3.join)(dir, entry);
    if (!(0, import_fs2.statSync)(skillDir).isDirectory()) continue;
    const skillFile = (0, import_path3.join)(skillDir, "SKILL.md");
    if (!(0, import_fs2.existsSync)(skillFile)) continue;
    const content = (0, import_fs2.readFileSync)(skillFile, "utf-8");
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) continue;
    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillDir,
      assignedAgents: getAgentAssignments(config, frontmatter.name)
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// src/cli/init.ts
var AGENT_SKILL_MAP = {
  tapestry: [
    "enforcing-csharp-standards",
    "enforcing-dotnet-testing",
    "verifying-release-builds"
  ],
  shuttle: ["enforcing-csharp-standards", "enforcing-dotnet-testing"],
  weft: ["reviewing-csharp-code"]
};
function generateConfig(enabledSkills, agentSkillMap) {
  const agents = {};
  for (const [agent, candidateSkills] of Object.entries(agentSkillMap)) {
    const skills = candidateSkills.filter((s) => enabledSkills.includes(s));
    if (skills.length > 0) {
      agents[agent] = { skills };
    }
  }
  const config = { agents };
  const json = JSON.stringify(config, null, 2);
  return `// Generated by weave-fleet init \u2014 customize as needed.
// This is deep-merged with ~/.config/opencode/weave-opencode.jsonc
${json}
`;
}
function runInit(directory, options = {}) {
  const { force = false, dryRun = false } = options;
  const projectDir = (0, import_path4.resolve)(directory);
  if (!(0, import_fs3.existsSync)(projectDir)) {
    throw new Error(`Directory does not exist: ${projectDir}`);
  }
  const configPath = getProjectWeaveConfigPath(projectDir);
  if ((0, import_fs3.existsSync)(configPath) && !force) {
    throw new Error(
      `Config already exists at ${configPath}. Use --force to overwrite.`
    );
  }
  const profile = detectProject(projectDir);
  const installed = listInstalledSkills();
  const installedNames = new Set(installed.map((s) => s.name));
  const enabledSkills = profile.suggestedSkills.filter(
    (s) => installedNames.has(s)
  );
  const configContent = generateConfig(enabledSkills, AGENT_SKILL_MAP);
  if (!dryRun) {
    const configDir = getProjectConfigDir(projectDir);
    (0, import_fs3.mkdirSync)(configDir, { recursive: true });
    (0, import_fs3.writeFileSync)(configPath, configContent, "utf-8");
  }
  return {
    configPath,
    profile,
    enabledSkills,
    written: !dryRun
  };
}

// src/cli/skill-installer.ts
var import_fs4 = require("fs");
var import_path5 = require("path");
function resolveSource(source) {
  if (source.startsWith("github:")) {
    const path = source.slice("github:".length);
    return {
      type: "url",
      resolved: `https://raw.githubusercontent.com/${path.replace(/^\//, "")}/HEAD/SKILL.md`
    };
  }
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return { type: "url", resolved: source };
  }
  return { type: "local", resolved: source };
}
async function fetchContent(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}
async function installSkill(source, options = {}) {
  const { force = false, agents, skillsDir, configPath } = options;
  const dir = skillsDir ?? getSkillsDir();
  const cfgPath = configPath ?? getUserWeaveConfigPath();
  const resolved = resolveSource(source);
  let content;
  if (resolved.type === "url") {
    content = await fetchContent(resolved.resolved);
  } else {
    if (!(0, import_fs4.existsSync)(resolved.resolved)) {
      throw new Error(`File not found: ${resolved.resolved}`);
    }
    content = (0, import_fs4.readFileSync)(resolved.resolved, "utf-8");
  }
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    throw new Error(
      "Invalid SKILL.md: missing or invalid YAML frontmatter. Expected --- fences with at least a 'name' field."
    );
  }
  if (!frontmatter.name) {
    throw new Error("Invalid SKILL.md: 'name' field is required in frontmatter.");
  }
  const skillDir = (0, import_path5.join)(dir, frontmatter.name);
  if ((0, import_fs4.existsSync)(skillDir) && !force) {
    throw new Error(
      `Skill '${frontmatter.name}' is already installed at ${skillDir}. Use --force to overwrite.`
    );
  }
  (0, import_fs4.mkdirSync)(skillDir, { recursive: true });
  (0, import_fs4.writeFileSync)((0, import_path5.join)(skillDir, "SKILL.md"), content, "utf-8");
  if (agents && agents.length > 0) {
    addSkillToAgents(frontmatter.name, agents, cfgPath);
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    path: skillDir,
    source
  };
}
function removeSkill(name, options = {}) {
  const { skillsDir, configPath } = options;
  const dir = skillsDir ?? getSkillsDir();
  const cfgPath = configPath ?? getUserWeaveConfigPath();
  const skillDir = (0, import_path5.join)(dir, name);
  if (!(0, import_fs4.existsSync)(skillDir)) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  (0, import_fs4.rmSync)(skillDir, { recursive: true, force: true });
  removeSkillFromAgents(name, cfgPath);
}
function addSkillToAgents(skillName, agents, configPath) {
  const config = readWeaveConfig(configPath) ?? {};
  if (!config.agents) {
    config.agents = {};
  }
  for (const agent of agents) {
    if (!config.agents[agent]) {
      config.agents[agent] = { skills: [] };
    }
    if (!config.agents[agent].skills) {
      config.agents[agent].skills = [];
    }
    if (!config.agents[agent].skills.includes(skillName)) {
      config.agents[agent].skills.push(skillName);
    }
  }
  writeConfigFile(configPath, config);
}
function removeSkillFromAgents(skillName, configPath) {
  const config = readWeaveConfig(configPath);
  if (!config?.agents) return;
  let changed = false;
  for (const [, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.skills) {
      const idx = agentConfig.skills.indexOf(skillName);
      if (idx !== -1) {
        agentConfig.skills.splice(idx, 1);
        changed = true;
      }
    }
  }
  if (changed) {
    writeConfigFile(configPath, config);
  }
}
function writeConfigFile(configPath, config) {
  const dir = (0, import_path5.dirname)(configPath);
  (0, import_fs4.mkdirSync)(dir, { recursive: true });
  const content = JSON.stringify(config, null, 2);
  (0, import_fs4.writeFileSync)(configPath, content, "utf-8");
}

// src/cli/skill.ts
function runSkillList() {
  const skills = listInstalledSkills();
  if (skills.length === 0) {
    console.log("No skills installed.");
    console.log(
      "Install skills with: weave-fleet skill install <url-or-path>"
    );
    return;
  }
  console.log(`
Installed Skills (${skills.length}):
`);
  const maxNameLen = Math.max(...skills.map((s) => s.name.length));
  for (const skill of skills) {
    const agents = skill.assignedAgents.length > 0 ? ` -> ${skill.assignedAgents.join(", ")}` : "";
    const name = skill.name.padEnd(maxNameLen + 2);
    console.log(`  ${name}${skill.description}${agents}`);
  }
  console.log();
}
async function runSkillInstall(source, options = {}) {
  try {
    const result = await installSkill(source, options);
    console.log(`
Installed skill: ${result.name}`);
    console.log(`  Description: ${result.description}`);
    console.log(`  Path: ${result.path}`);
    if (options.agents && options.agents.length > 0) {
      console.log(`  Assigned to agents: ${options.agents.join(", ")}`);
    }
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
function runSkillRemove(name) {
  try {
    removeSkill(name);
    console.log(`Removed skill: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// src/cli/index.ts
var VERSION = "0.1.6";
function printUsage() {
  console.log(`weave-fleet CLI v${VERSION}`);
  console.log();
  console.log("Usage: weave-fleet <command> [options]");
  console.log();
  console.log("Commands:");
  console.log("  init <directory>              Initialize a project with skill configuration");
  console.log("  skill list                    List installed skills");
  console.log("  skill install <source>        Install a skill from URL or local path");
  console.log("  skill remove <name>           Remove an installed skill");
  console.log();
  console.log("Init Options:");
  console.log("  --force                       Overwrite existing configuration");
  console.log("  --dry-run                     Print what would be generated without writing");
  console.log();
  console.log("Skill Install Options:");
  console.log("  --force                       Overwrite existing skill");
  console.log("  --agent <agents>              Comma-separated agent names to assign the skill to");
  console.log();
  console.log("Sources for skill install:");
  console.log("  https://...                   Raw URL to a SKILL.md file");
  console.log("  github:user/repo/path         GitHub repository shorthand");
  console.log("  /path/to/SKILL.md             Local file path");
  console.log();
  console.log("Server Options (when starting without a subcommand):");
  console.log("  --port <number>               Server port (default: 3000)");
}
function parseArgs(argv) {
  const command = argv[0] ?? "";
  const args = [];
  const flags = {};
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[flagName] = argv[i + 1];
        i += 2;
      } else {
        flags[flagName] = true;
        i++;
      }
    } else if (arg.startsWith("-")) {
      const flagName = arg.slice(1);
      flags[flagName] = true;
      i++;
    } else {
      args.push(arg);
      i++;
    }
  }
  return { command, args, flags };
}
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    printUsage();
    process.exit(0);
  }
  const { command, args, flags } = parseArgs(argv);
  switch (command) {
    case "init": {
      if (flags["help"] || flags["h"]) {
        console.log("Usage: weave-fleet init <directory> [--force] [--dry-run]");
        console.log();
        console.log("Initialize a project directory with Weave skill configuration.");
        console.log("Detects project technologies and generates .opencode/weave-opencode.jsonc");
        console.log();
        console.log("Options:");
        console.log("  --force     Overwrite existing configuration");
        console.log("  --dry-run   Print what would be generated without writing");
        process.exit(0);
      }
      const directory = args[0];
      if (!directory) {
        console.error("Error: directory argument is required.");
        console.error("Usage: weave-fleet init <directory>");
        process.exit(1);
      }
      try {
        const result = runInit(directory, {
          force: Boolean(flags["force"]),
          dryRun: Boolean(flags["dry-run"])
        });
        console.log();
        if (result.profile.languages.length > 0) {
          const techs = [
            ...result.profile.languages,
            ...result.profile.frameworks
          ].join(", ");
          console.log(`Detected: ${techs}`);
        } else {
          console.log("No specific language/framework detected.");
        }
        if (result.profile.isGitRepo) {
          console.log("Git repository: yes");
        }
        if (result.enabledSkills.length > 0) {
          console.log(`Enabled skills: ${result.enabledSkills.join(", ")}`);
        } else {
          console.log("No matching skills found (install skills with: weave-fleet skill install <source>)");
        }
        if (result.written) {
          console.log(`
Config written to: ${result.configPath}`);
        } else {
          console.log(`
Dry run \u2014 would write to: ${result.configPath}`);
        }
        console.log();
        console.log("Next steps:");
        console.log("  Run `weave-fleet` to start the dashboard");
        console.log("  Run `weave-fleet skill list` to see all available skills");
        console.log();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
      break;
    }
    case "skill": {
      const subCommand = args[0];
      if (!subCommand || flags["help"] || flags["h"]) {
        console.log("Usage: weave-fleet skill <subcommand> [options]");
        console.log();
        console.log("Subcommands:");
        console.log("  list                    List installed skills");
        console.log("  install <source>        Install a skill from URL or local path");
        console.log("  remove <name>           Remove an installed skill");
        process.exit(0);
      }
      switch (subCommand) {
        case "list":
          runSkillList();
          break;
        case "install": {
          const source = args[1];
          if (!source) {
            console.error("Error: source argument is required.");
            console.error("Usage: weave-fleet skill install <url-or-path> [--force] [--agent <agents>]");
            process.exit(1);
          }
          const agentStr = flags["agent"];
          const agents = typeof agentStr === "string" ? agentStr.split(",").map((a) => a.trim()) : void 0;
          await runSkillInstall(source, {
            force: Boolean(flags["force"]),
            agents
          });
          break;
        }
        case "remove": {
          const name = args[1];
          if (!name) {
            console.error("Error: skill name is required.");
            console.error("Usage: weave-fleet skill remove <name>");
            process.exit(1);
          }
          runSkillRemove(name);
          break;
        }
        default:
          console.error(`Unknown skill subcommand: ${subCommand}`);
          console.error("Run 'weave-fleet skill --help' for usage.");
          process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'weave-fleet --help' for usage.");
      process.exit(1);
  }
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
