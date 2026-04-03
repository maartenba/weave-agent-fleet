import { describe, it, expect } from "vitest";
import { validateFileName } from "@/lib/file-name-validation";

describe("validateFileName", () => {
  // ── Valid names ──────────────────────────────────────────────────────────

  it("AcceptsSimpleFilename", () => {
    expect(validateFileName("file.ts")).toEqual({ valid: true });
  });

  it("AcceptsComponentFilename", () => {
    expect(validateFileName("my-component.tsx")).toEqual({ valid: true });
  });

  it("AcceptsDotfile", () => {
    expect(validateFileName(".env")).toEqual({ valid: true });
  });

  it("AcceptsFileWithNoExtension", () => {
    expect(validateFileName("Makefile")).toEqual({ valid: true });
  });

  it("AcceptsSingleCharName", () => {
    expect(validateFileName("a")).toEqual({ valid: true });
  });

  it("AcceptsNameWithSpaces", () => {
    expect(validateFileName("file with spaces.txt")).toEqual({ valid: true });
  });

  it("Accepts255CharName", () => {
    expect(validateFileName("a".repeat(255))).toEqual({ valid: true });
  });

  // ── Invalid: empty / whitespace ──────────────────────────────────────────

  it("RejectsEmptyString", () => {
    const result = validateFileName("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("RejectsWhitespaceOnly", () => {
    const result = validateFileName("   ");
    expect(result.valid).toBe(false);
  });

  // ── Invalid: path separators ─────────────────────────────────────────────

  it("RejectsForwardSlash", () => {
    const result = validateFileName("/");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/separator/i);
  });

  it("RejectsPathWithForwardSlash", () => {
    const result = validateFileName("a/b");
    expect(result.valid).toBe(false);
  });

  it("RejectsBackslash", () => {
    const result = validateFileName("a\\b");
    expect(result.valid).toBe(false);
  });

  // ── Invalid: dot-only names ──────────────────────────────────────────────

  it("RejectsSingleDot", () => {
    const result = validateFileName(".");
    expect(result.valid).toBe(false);
  });

  it("RejectsDoubleDot", () => {
    const result = validateFileName("..");
    expect(result.valid).toBe(false);
  });

  // ── Invalid: reserved OS names ───────────────────────────────────────────

  it("RejectsCON", () => {
    const result = validateFileName("CON");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved/i);
  });

  it("RejectsConLowercase", () => {
    const result = validateFileName("con");
    expect(result.valid).toBe(false);
  });

  it("RejectsNULWithExtension", () => {
    const result = validateFileName("NUL.txt");
    expect(result.valid).toBe(false);
  });

  it("RejectsCOM1", () => {
    const result = validateFileName("COM1");
    expect(result.valid).toBe(false);
  });

  it("RejectsLPT9", () => {
    const result = validateFileName("LPT9");
    expect(result.valid).toBe(false);
  });

  // ── Invalid: too long ────────────────────────────────────────────────────

  it("Rejects256CharName", () => {
    const result = validateFileName("a".repeat(256));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/255/i);
  });

  // ── Invalid: null bytes ──────────────────────────────────────────────────

  it("RejectsNullByte", () => {
    const result = validateFileName("file\0name");
    expect(result.valid).toBe(false);
  });

  // ── Invalid: forbidden characters ────────────────────────────────────────

  it("RejectsLessThan", () => {
    const result = validateFileName("file<name");
    expect(result.valid).toBe(false);
  });

  it("RejectsGreaterThan", () => {
    const result = validateFileName("file>name");
    expect(result.valid).toBe(false);
  });

  it("RejectsColon", () => {
    const result = validateFileName("file:name");
    expect(result.valid).toBe(false);
  });

  it("RejectsDoubleQuote", () => {
    const result = validateFileName('file"name');
    expect(result.valid).toBe(false);
  });

  it("RejectsPipe", () => {
    const result = validateFileName("file|name");
    expect(result.valid).toBe(false);
  });

  it("RejectsQuestionMark", () => {
    const result = validateFileName("file?name");
    expect(result.valid).toBe(false);
  });

  it("RejectsAsterisk", () => {
    const result = validateFileName("file*name");
    expect(result.valid).toBe(false);
  });

  // ── Invalid: trailing dot or space ───────────────────────────────────────

  it("RejectsTrailingDot", () => {
    const result = validateFileName("name.");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/dot or space/i);
  });

  it("RejectsTrailingSpace", () => {
    const result = validateFileName("name ");
    expect(result.valid).toBe(false);
  });
});
