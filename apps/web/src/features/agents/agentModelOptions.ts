import type { Overview, ProviderCatalog } from "../../api/contracts";

export type AgentModelChoice = {
  id: string;
  label: string;
  modelBackend: string;
  cliCommand: string | null;
};

export function connectedAgentModels(catalog: ProviderCatalog | null, settings: Overview["settings"]) {
  if (!catalog) return [];
  return catalog.llmProviders
    .filter((provider) => {
      if (provider.authenticationStatus?.authenticated) return true;
      const commandKeys = catalog.providerCommandKeys.examples.find(
        (example) => example.modelBackend === provider.id,
      )?.keys || [provider.id];
      return Boolean(
        provider.defaultCommand ||
        commandKeys.some((key) => settings.providerCommands[key]?.trim()),
      );
    })
    .map(({ id, label }) => ({ id, label }));
}

export function connectedAgentModelChoices(catalog: ProviderCatalog | null, settings: Overview["settings"]): AgentModelChoice[] {
  return connectedAgentModels(catalog, settings).flatMap<AgentModelChoice>((provider) => {
    if (provider.id !== "ollama") {
      return [{ id: provider.id, label: provider.label, modelBackend: provider.id, cliCommand: null }];
    }
    const models = catalog?.llmProviders.find((item) => item.id === "ollama")?.ollamaStatus?.models || [];
    if (!models.length) {
      return [{ id: provider.id, label: provider.label, modelBackend: provider.id, cliCommand: null }];
    }
    return models.map((model) => ({
      id: `ollama:${model.name}`,
      label: `${provider.label} · ${model.name}`,
      modelBackend: provider.id,
      cliCommand: `ollama run ${JSON.stringify(model.name)} < "$HARNESS_PROMPT_FILE"`,
    }));
  });
}

export function selectedAgentModelChoice(
  modelBackend: string,
  cliCommand: string | null | undefined,
  choices: AgentModelChoice[],
) {
  return choices.find((choice) => choice.modelBackend === modelBackend && choice.cliCommand === (cliCommand || null))
    || choices.find((choice) => choice.modelBackend === modelBackend && choice.cliCommand === null)
    || null;
}

export function modelIsConnected(
  modelBackend: string,
  catalog: ProviderCatalog | null,
  settings: Overview["settings"],
) {
  return connectedAgentModels(catalog, settings).some((model) => model.id === modelBackend);
}
