import {
  getLanguageFromPath,
  getMonacoLanguageFromPath,
  countLines,
  diffSummary,
  parseGrepOutput,
  parseGlobOutput,
} from "@/lib/tool-card-utils";

// ─── getLanguageFromPath ───────────────────────────────────────────────────────

describe("getLanguageFromPath", () => {
  it("detects TypeScript by .ts extension", () => {
    expect(getLanguageFromPath("src/index.ts")).toBe("typescript");
  });

  it("detects TypeScript by .tsx extension", () => {
    expect(getLanguageFromPath("src/App.tsx")).toBe("typescript");
  });

  it("detects JavaScript by .js extension", () => {
    expect(getLanguageFromPath("src/utils.js")).toBe("javascript");
  });

  it("detects JavaScript by .jsx extension", () => {
    expect(getLanguageFromPath("src/component.jsx")).toBe("javascript");
  });

  it("detects Python by .py extension", () => {
    expect(getLanguageFromPath("script.py")).toBe("python");
  });

  it("detects Bash by .sh extension", () => {
    expect(getLanguageFromPath("run.sh")).toBe("bash");
  });

  it("detects Markdown by .md extension", () => {
    expect(getLanguageFromPath("README.md")).toBe("markdown");
  });

  it("detects JSON by .json extension", () => {
    expect(getLanguageFromPath("package.json")).toBe("json");
  });

  it("detects well-known filename 'Dockerfile'", () => {
    expect(getLanguageFromPath("Dockerfile")).toBe("dockerfile");
  });

  it("detects well-known filename 'Makefile'", () => {
    expect(getLanguageFromPath("Makefile")).toBe("makefile");
  });

  it("returns empty string for unknown extension", () => {
    expect(getLanguageFromPath("file.unknownext")).toBe("");
  });

  it("returns empty string for file with no extension", () => {
    expect(getLanguageFromPath("LICENSE")).toBe("");
  });

  it("is case-insensitive for extensions", () => {
    expect(getLanguageFromPath("file.TS")).toBe("typescript");
    expect(getLanguageFromPath("file.PY")).toBe("python");
  });
});

// ─── getMonacoLanguageFromPath ─────────────────────────────────────────────────

describe("getMonacoLanguageFromPath", () => {
  it("returns 'typescript' for .ts files", () => {
    expect(getMonacoLanguageFromPath("src/index.ts")).toBe("typescript");
  });

  it("returns 'typescript' for .tsx files", () => {
    expect(getMonacoLanguageFromPath("src/App.tsx")).toBe("typescript");
  });

  it("returns 'javascript' for .js files", () => {
    expect(getMonacoLanguageFromPath("src/utils.js")).toBe("javascript");
  });

  it("returns 'python' for .py files", () => {
    expect(getMonacoLanguageFromPath("script.py")).toBe("python");
  });

  it("maps bash (.sh) → 'shell' (Monaco uses 'shell' not 'bash')", () => {
    expect(getMonacoLanguageFromPath("run.sh")).toBe("shell");
  });

  it("maps .zsh → 'shell'", () => {
    expect(getMonacoLanguageFromPath("config.zsh")).toBe("shell");
  });

  it("maps .env → 'shell'", () => {
    expect(getMonacoLanguageFromPath(".env")).toBe("shell");
  });

  it("returns 'markdown' for .md files", () => {
    expect(getMonacoLanguageFromPath("README.md")).toBe("markdown");
  });

  it("returns 'markdown' for .mdx files", () => {
    expect(getMonacoLanguageFromPath("page.mdx")).toBe("markdown");
  });

  it("returns 'json' for .json files", () => {
    expect(getMonacoLanguageFromPath("package.json")).toBe("json");
  });

  it("returns 'yaml' for .yaml files", () => {
    expect(getMonacoLanguageFromPath("config.yaml")).toBe("yaml");
  });

  it("returns 'yaml' for .yml files", () => {
    expect(getMonacoLanguageFromPath(".github/workflows/ci.yml")).toBe("yaml");
  });

  it("returns 'ini' for .toml files (hljs 'ini' → Monaco 'ini')", () => {
    expect(getMonacoLanguageFromPath("Cargo.toml")).toBe("ini");
  });

  it("returns 'ini' for .ini files", () => {
    expect(getMonacoLanguageFromPath("config.ini")).toBe("ini");
  });

  it("returns 'ini' for .conf files", () => {
    expect(getMonacoLanguageFromPath("nginx.conf")).toBe("ini");
  });

  it("returns 'css' for .css files", () => {
    expect(getMonacoLanguageFromPath("styles.css")).toBe("css");
  });

  it("returns 'scss' for .scss files", () => {
    expect(getMonacoLanguageFromPath("styles.scss")).toBe("scss");
  });

  it("returns 'html' for .html files", () => {
    expect(getMonacoLanguageFromPath("index.html")).toBe("html");
  });

  it("returns 'xml' for .xml files", () => {
    expect(getMonacoLanguageFromPath("config.xml")).toBe("xml");
  });

  it("returns 'xml' for .svg files (svg treated as xml)", () => {
    expect(getMonacoLanguageFromPath("icon.svg")).toBe("xml");
  });

  it("returns 'sql' for .sql files", () => {
    expect(getMonacoLanguageFromPath("query.sql")).toBe("sql");
  });

  it("returns 'dockerfile' for Dockerfile", () => {
    expect(getMonacoLanguageFromPath("Dockerfile")).toBe("dockerfile");
  });

  it("returns 'c' for .c files", () => {
    expect(getMonacoLanguageFromPath("main.c")).toBe("c");
  });

  it("returns 'cpp' for .cpp files", () => {
    expect(getMonacoLanguageFromPath("main.cpp")).toBe("cpp");
  });

  it("returns 'rust' for .rs files", () => {
    expect(getMonacoLanguageFromPath("main.rs")).toBe("rust");
  });

  it("returns 'go' for .go files", () => {
    expect(getMonacoLanguageFromPath("main.go")).toBe("go");
  });

  it("returns 'java' for .java files", () => {
    expect(getMonacoLanguageFromPath("Main.java")).toBe("java");
  });

  it("returns 'csharp' for .cs files", () => {
    expect(getMonacoLanguageFromPath("Program.cs")).toBe("csharp");
  });

  it("returns 'swift' for .swift files", () => {
    expect(getMonacoLanguageFromPath("App.swift")).toBe("swift");
  });

  it("returns 'php' for .php files", () => {
    expect(getMonacoLanguageFromPath("index.php")).toBe("php");
  });

  it("returns 'ruby' for .rb files", () => {
    expect(getMonacoLanguageFromPath("app.rb")).toBe("ruby");
  });

  it("returns 'scala' for .scala files", () => {
    expect(getMonacoLanguageFromPath("Main.scala")).toBe("scala");
  });

  it("returns 'lua' for .lua files", () => {
    expect(getMonacoLanguageFromPath("script.lua")).toBe("lua");
  });

  it("returns 'hcl' for .tf files (Terraform)", () => {
    expect(getMonacoLanguageFromPath("main.tf")).toBe("hcl");
  });

  it("returns 'hcl' for .hcl files", () => {
    expect(getMonacoLanguageFromPath("config.hcl")).toBe("hcl");
  });

  it("returns 'plaintext' for .zig files (no Monaco built-in)", () => {
    expect(getMonacoLanguageFromPath("main.zig")).toBe("plaintext");
  });

  it("returns 'plaintext' for unknown extension", () => {
    expect(getMonacoLanguageFromPath("file.unknownext")).toBe("plaintext");
  });

  it("returns 'plaintext' for file with no extension", () => {
    expect(getMonacoLanguageFromPath("LICENSE")).toBe("plaintext");
  });

  it("is case-insensitive for extensions", () => {
    expect(getMonacoLanguageFromPath("file.TS")).toBe("typescript");
    expect(getMonacoLanguageFromPath("file.PY")).toBe("python");
    expect(getMonacoLanguageFromPath("file.SH")).toBe("shell");
  });

  it("handles deeply nested paths correctly", () => {
    expect(getMonacoLanguageFromPath("a/b/c/d/e/deep.ts")).toBe("typescript");
  });
});

// ─── countLines ───────────────────────────────────────────────────────────────

describe("countLines", () => {
  it("returns 0 for empty string", () => {
    expect(countLines("")).toBe(0);
  });

  it("returns 1 for a single line without newline", () => {
    expect(countLines("hello")).toBe(1);
  });

  it("returns 1 for a single line with trailing newline", () => {
    expect(countLines("hello\n")).toBe(1);
  });

  it("returns 2 for two lines", () => {
    expect(countLines("line1\nline2")).toBe(2);
  });

  it("returns 3 for three lines with trailing newline", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
  });
});

// ─── parseGrepOutput ──────────────────────────────────────────────────────────

describe("parseGrepOutput", () => {
  it("returns empty array for empty string", () => {
    expect(parseGrepOutput("")).toEqual([]);
  });

  it("parses a single file:line entry", () => {
    expect(parseGrepOutput("src/index.ts:42")).toEqual([{ file: "src/index.ts", line: 42 }]);
  });

  it("parses multiple entries", () => {
    const result = parseGrepOutput("src/a.ts:1\nsrc/b.ts:20");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ file: "src/a.ts", line: 1 });
    expect(result[1]).toEqual({ file: "src/b.ts", line: 20 });
  });

  it("ignores blank lines", () => {
    expect(parseGrepOutput("src/a.ts:1\n\nsrc/b.ts:2")).toHaveLength(2);
  });
});

// ─── parseGlobOutput ──────────────────────────────────────────────────────────

describe("parseGlobOutput", () => {
  it("returns empty array for empty string", () => {
    expect(parseGlobOutput("")).toEqual([]);
  });

  it("parses single path", () => {
    expect(parseGlobOutput("src/index.ts")).toEqual(["src/index.ts"]);
  });

  it("parses multiple paths", () => {
    expect(parseGlobOutput("src/a.ts\nsrc/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("trims whitespace from paths", () => {
    expect(parseGlobOutput("  src/a.ts  \n  src/b.ts  ")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("ignores blank lines", () => {
    expect(parseGlobOutput("src/a.ts\n\nsrc/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
