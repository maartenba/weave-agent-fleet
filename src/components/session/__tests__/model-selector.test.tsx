import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import {
  composeSearchValue,
  modelValue,
  ModelSelector,
  parseModelValue,
} from "../model-selector";
import type { AvailableProvider } from "@/lib/api-types";

// ─── Pure-function tests ──────────────────────────────────────────────────────

describe("composeSearchValue", () => {
  it("includes provider name, model name, and model ID", () => {
    const result = composeSearchValue(
      "OpenRouter",
      "Claude 3.5 Sonnet",
      "anthropic/claude-3.5-sonnet"
    );
    expect(result).toContain("OpenRouter");
    expect(result).toContain("Claude 3.5 Sonnet");
    expect(result).toContain("anthropic/claude-3.5-sonnet");
  });

  it("handles empty strings without crashing", () => {
    const result = composeSearchValue("", "", "");
    expect(typeof result).toBe("string");
  });

  it("separates fields with spaces for multi-field matching", () => {
    const result = composeSearchValue("Anthropic", "Haiku", "claude-3-haiku");
    expect(result).toBe("Anthropic Haiku claude-3-haiku");
  });
});

describe("parseModelValue", () => {
  it("parses providerID::modelID format", () => {
    expect(parseModelValue("openai::gpt-4")).toEqual({
      providerID: "openai",
      modelID: "gpt-4",
    });
  });

  it("returns null for __default__", () => {
    expect(parseModelValue("__default__")).toBeNull();
  });

  it("returns null for value without separator", () => {
    expect(parseModelValue("no-separator")).toBeNull();
  });

  it("handles model IDs containing colons", () => {
    expect(parseModelValue("aws::us.anthropic.claude-3:5")).toEqual({
      providerID: "aws",
      modelID: "us.anthropic.claude-3:5",
    });
  });
});

describe("modelValue", () => {
  it("encodes providerID::modelID", () => {
    expect(modelValue("openai", "gpt-4")).toBe("openai::gpt-4");
  });

  it("round-trips through parseModelValue", () => {
    const encoded = modelValue("anthropic", "claude-3.5-sonnet");
    const decoded = parseModelValue(encoded);
    expect(decoded).toEqual({
      providerID: "anthropic",
      modelID: "claude-3.5-sonnet",
    });
  });

  it("round-trips with colons in model ID", () => {
    const encoded = modelValue("aws", "us.anthropic.claude-3:5");
    const decoded = parseModelValue(encoded);
    expect(decoded).toEqual({
      providerID: "aws",
      modelID: "us.anthropic.claude-3:5",
    });
  });

  it("round-trips with slashes in model ID", () => {
    const encoded = modelValue("openrouter", "anthropic/claude-3.5-sonnet");
    const decoded = parseModelValue(encoded);
    expect(decoded).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-3.5-sonnet",
    });
  });
});

// ─── Component tests ──────────────────────────────────────────────────────────

const PROVIDERS: AvailableProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-4", name: "GPT-4" },
      { id: "gpt-4o", name: "GPT-4o" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: [{ id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" }],
  },
];

function renderSelector(
  props: Partial<React.ComponentProps<typeof ModelSelector>> = {}
) {
  const defaultProps = {
    providers: PROVIDERS,
    selectedModel: null,
    onSelect: vi.fn(),
    ...props,
  };
  return { ...render(<ModelSelector {...defaultProps} />), onSelect: defaultProps.onSelect };
}

describe("ModelSelector (component)", () => {
  it("renders trigger button with model icon", () => {
    renderSelector();
    const btn = screen.getByRole("button");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("title")).toBe("Model");
  });

  it("trigger button has correct aria attributes when closed", () => {
    renderSelector();
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-haspopup")).toBe("listbox");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows selected model name in button title", () => {
    renderSelector({
      selectedModel: { providerID: "openai", modelID: "gpt-4" },
    });
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toBe("OpenAI / GPT-4");
  });

  it("falls back to raw modelID when provider not found", () => {
    renderSelector({
      selectedModel: { providerID: "unknown", modelID: "mystery-model" },
    });
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toBe("mystery-model");
  });

  it("opens popover on click and shows search input", () => {
    renderSelector();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Search models…")).toBeTruthy();
  });

  it("shows Default option inside the command list", () => {
    renderSelector();
    fireEvent.click(screen.getByRole("button"));
    const defaultOption = screen.getByText("Default");
    expect(defaultOption.closest("[cmdk-item]")).toBeTruthy();
  });

  it("shows all provider groups and models", () => {
    renderSelector();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("GPT-4")).toBeTruthy();
    expect(screen.getByText("GPT-4o")).toBeTruthy();
    expect(screen.getByText("Claude 3.5 Sonnet")).toBeTruthy();
  });

  it("calls onSelect with model when a model item is clicked", () => {
    const { onSelect } = renderSelector();
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("GPT-4"));
    expect(onSelect).toHaveBeenCalledWith({
      providerID: "openai",
      modelID: "gpt-4",
    });
  });

  it("calls onSelect(null) when Default is clicked", () => {
    const { onSelect } = renderSelector({
      selectedModel: { providerID: "openai", modelID: "gpt-4" },
    });
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Default"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("disables trigger button when disabled prop is true", () => {
    renderSelector({ disabled: true });
    const btn = screen.getByRole("button");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("renders with empty providers without crashing", () => {
    renderSelector({ providers: [] });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("has aria-label on the command root", () => {
    renderSelector();
    fireEvent.click(screen.getByRole("button"));
    const cmd = document.querySelector("[aria-label='Select model']");
    expect(cmd).toBeTruthy();
  });
});
