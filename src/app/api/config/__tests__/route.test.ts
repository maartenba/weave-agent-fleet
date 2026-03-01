import { tmpdir } from "os";
import { join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { randomUUID } from "crypto";
import {
  getUserConfig,
  getProjectConfig,
  getMergedConfig,
  updateUserConfig,
  listInstalledSkills,
  getConfigPaths,
} from "@/lib/server/config-manager";

// We need to mock the config-paths module to use temp directories
// so we don't modify real user config during tests

let testConfigDir: string;
let testSkillsDir: string;

vi.mock("@/cli/config-paths", () => {
  return {
    getUserConfigDir: () => testConfigDir,
    getUserWeaveConfigPath: () => join(testConfigDir, "weave-opencode.jsonc"),
    getSkillsDir: () => testSkillsDir,
    getProjectConfigDir: (dir: string) => join(dir, ".opencode"),
    getProjectWeaveConfigPath: (dir: string) =>
      join(dir, ".opencode", "weave-opencode.jsonc"),
  };
});

describe("config-manager", () => {
  let testProjectDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `config-mgr-test-${randomUUID()}`);
    testSkillsDir = join(testConfigDir, "skills");
    testProjectDir = join(tmpdir(), `project-test-${randomUUID()}`);
    mkdirSync(testConfigDir, { recursive: true });
    mkdirSync(testSkillsDir, { recursive: true });
    mkdirSync(testProjectDir, { recursive: true });
  });

  afterEach(() => {
    for (const dir of [testConfigDir, testProjectDir]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe("getUserConfig", () => {
    it("ReturnsNullWhenNoConfigExists", () => {
      const result = getUserConfig();
      expect(result).toBeNull();
    });

    it("ReturnsConfigWhenFileExists", () => {
      const configPath = join(testConfigDir, "weave-opencode.jsonc");
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: { tapestry: { skills: ["skill-a"] } },
        })
      );

      const result = getUserConfig();
      expect(result).not.toBeNull();
      expect(result!.agents!.tapestry.skills).toEqual(["skill-a"]);
    });
  });

  describe("updateUserConfig", () => {
    it("WritesConfigFile", () => {
      const config = {
        agents: { shuttle: { skills: ["new-skill"] } },
      };
      updateUserConfig(config);

      const configPath = join(testConfigDir, "weave-opencode.jsonc");
      expect(existsSync(configPath)).toBe(true);

      const content = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(content.agents.shuttle.skills).toEqual(["new-skill"]);
    });
  });

  describe("getProjectConfig", () => {
    it("ReturnsNullWhenNoProjectConfig", () => {
      const result = getProjectConfig(testProjectDir);
      expect(result).toBeNull();
    });

    it("ReturnsProjectConfigWhenExists", () => {
      const configDir = join(testProjectDir, ".opencode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "weave-opencode.jsonc"),
        JSON.stringify({
          agents: { weft: { skills: ["reviewing-code"] } },
        })
      );

      const result = getProjectConfig(testProjectDir);
      expect(result).not.toBeNull();
      expect(result!.agents!.weft.skills).toEqual(["reviewing-code"]);
    });
  });

  describe("getMergedConfig", () => {
    it("MergesUserAndProjectConfigs", () => {
      // User config
      const userPath = join(testConfigDir, "weave-opencode.jsonc");
      writeFileSync(
        userPath,
        JSON.stringify({
          agents: {
            tapestry: { skills: ["user-skill"] },
            shuttle: { skills: ["shared-skill"] },
          },
        })
      );

      // Project config
      const projectConfigDir = join(testProjectDir, ".opencode");
      mkdirSync(projectConfigDir, { recursive: true });
      writeFileSync(
        join(projectConfigDir, "weave-opencode.jsonc"),
        JSON.stringify({
          agents: {
            shuttle: { skills: ["project-skill"] },
            weft: { skills: ["project-only"] },
          },
        })
      );

      const result = getMergedConfig(testProjectDir);

      expect(result.agents!.tapestry.skills).toEqual(["user-skill"]);
      // Project overrides user for shuttle
      expect(result.agents!.shuttle.skills).toEqual(["project-skill"]);
      expect(result.agents!.weft.skills).toEqual(["project-only"]);
    });

    it("ReturnsUserConfigWhenNoProjectConfig", () => {
      const userPath = join(testConfigDir, "weave-opencode.jsonc");
      writeFileSync(
        userPath,
        JSON.stringify({
          agents: { tapestry: { skills: ["only-user"] } },
        })
      );

      const result = getMergedConfig(testProjectDir);
      expect(result.agents!.tapestry.skills).toEqual(["only-user"]);
    });
  });

  describe("listInstalledSkills", () => {
    it("ListsSkillsFromSkillsDir", () => {
      const skillDir = join(testSkillsDir, "test-skill");
      mkdirSync(skillDir);
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: test-skill\ndescription: A test\n---\n# Content`
      );

      const result = listInstalledSkills();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("test-skill");
    });
  });

  describe("getConfigPaths", () => {
    it("ReturnsExpectedPaths", () => {
      const paths = getConfigPaths();
      expect(paths.userConfig).toContain("weave-opencode.jsonc");
      expect(paths.skillsDir).toContain("skills");
    });
  });
});
