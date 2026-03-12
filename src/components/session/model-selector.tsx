"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { AvailableProvider } from "@/lib/api-types";
import { ChevronDownIcon, Cpu } from "lucide-react";

export interface SelectedModel {
  providerID: string;
  modelID: string;
}

interface ModelSelectorProps {
  providers: AvailableProvider[];
  selectedModel: SelectedModel | null;
  onSelect: (model: SelectedModel | null) => void;
  disabled?: boolean;
}

const DEFAULT_VALUE = "__default__";

function modelValue(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`;
}

function parseModelValue(value: string): SelectedModel | null {
  if (value === DEFAULT_VALUE) return null;
  const sep = value.indexOf("::");
  if (sep === -1) return null;
  return { providerID: value.slice(0, sep), modelID: value.slice(sep + 2) };
}

export function ModelSelector({
  providers,
  selectedModel,
  onSelect,
  disabled,
}: ModelSelectorProps) {
  const currentValue = selectedModel
    ? modelValue(selectedModel.providerID, selectedModel.modelID)
    : DEFAULT_VALUE;

  // Build a human-readable label for the trigger button
  let label = "Model";
  if (selectedModel) {
    const provider = providers.find((p) => p.id === selectedModel.providerID);
    const model = provider?.models.find((m) => m.id === selectedModel.modelID);
    if (provider && model) {
      label = `${provider.name} / ${model.name}`;
    } else {
      label = selectedModel.modelID;
    }
  }

  function handleValueChange(value: string) {
    onSelect(parseModelValue(value));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-9 gap-1.5 px-2.5 text-xs max-w-[180px]"
        >
          <Cpu className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="h-3 w-3 text-muted-foreground shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={currentValue}
          onValueChange={handleValueChange}
        >
          <DropdownMenuRadioItem value={DEFAULT_VALUE} className="text-xs">
            Default
          </DropdownMenuRadioItem>
          {providers.map((provider) => (
            <div key={provider.id}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
                {provider.name}
              </DropdownMenuLabel>
              {provider.models.map((model) => (
                <DropdownMenuRadioItem
                  key={model.id}
                  value={modelValue(provider.id, model.id)}
                  className="text-xs"
                >
                  {model.name}
                </DropdownMenuRadioItem>
              ))}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
