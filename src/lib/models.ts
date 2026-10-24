// Helpers for choosing a model from orchestrator_capabilities.

import type { ModelOption, ModelSelection, Provider, ProviderModel, RuntimeMode } from "./t3";
import { RUNTIME_MODES } from "./t3";

export const PROJECT_DEFAULT_MODEL = "project-default";

const EFFORT_OPTION_IDS = ["effort", "reasoningEffort", "variant"];

export function modelKey(selection: Pick<ModelSelection, "instanceId" | "model">): string {
  return `${selection.instanceId}::${selection.model}`;
}

export function parseModelKey(key: string): { instanceId: string; model: string } | null {
  const separator = key.indexOf("::");
  if (separator < 0) return null;
  return { instanceId: key.slice(0, separator), model: key.slice(separator + 2) };
}

export function findModel(
  providers: Provider[],
  selection: Pick<ModelSelection, "instanceId" | "model"> | null,
): { provider: Provider; model: ProviderModel } | null {
  if (!selection) return null;
  const provider = providers.find((entry) => entry.providerInstanceId === selection.instanceId);
  const model = provider?.models.find((entry) => entry.id === selection.model);
  return provider && model ? { provider, model } : null;
}

/** The reasoning effort option for a model, when it has one with string values. */
export function effortOption(model: ProviderModel | undefined): ModelOption | undefined {
  return model?.options?.find(
    (option) => EFFORT_OPTION_IDS.includes(option.id) && option.values?.every((value) => typeof value === "string"),
  );
}

export function modelLabel(model: ProviderModel): string {
  return model.label ?? model.id;
}

/**
 * Runtime modes the user may pick: within the connection's approved ceiling
 * and, when the provider declares a list, supported by the provider.
 */
export function allowedRuntimeModes(ceiling: RuntimeMode, provider: Provider | undefined): RuntimeMode[] {
  const ceilingIndex = RUNTIME_MODES.indexOf(ceiling);
  return RUNTIME_MODES.filter(
    (mode, index) => index <= ceilingIndex && (!provider?.runtimeModes || provider.runtimeModes.includes(mode)),
  );
}

/**
 * Keeps the preferred mode when allowed, otherwise the narrowest allowed mode.
 * Prompts carry page and Slack content, so access never widens by default.
 */
export function resolveRuntimeMode(preferred: RuntimeMode | undefined, allowed: RuntimeMode[]): RuntimeMode | undefined {
  if (preferred && allowed.includes(preferred)) return preferred;
  return allowed[0];
}
