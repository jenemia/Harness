import type { Overview, ProviderCatalog } from "../../api/contracts";

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

export function modelIsConnected(
  modelBackend: string,
  catalog: ProviderCatalog | null,
  settings: Overview["settings"],
) {
  return connectedAgentModels(catalog, settings).some((model) => model.id === modelBackend);
}
