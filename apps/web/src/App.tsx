import { createClientStatePersistence, FluxApp, type FluxRuntime } from "@flux/app-core";
import { WebFluxClient } from "@flux/client-web";

const client = new WebFluxClient();
const statePersistence = createClientStatePersistence(client);
const webRuntime: FluxRuntime = {
  label: "Web",
  client,
  vaultAccess: "registry",
  statePersistence,
  getWindowId: async () => {
    const key = "flux-window-id";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  },
  connect: async () => {
    try {
      const status = await client.getStatus();
      return status.openVault
        ? `Go backend connected · ${status.openVault.name}`
        : "Go backend connected · no vault open";
    } catch {
      return "Go backend offline · start the server on port 8080";
    }
  },
  selectVaultDirectory: async (mode) => {
    if (mode !== "create") return null;
    const name = window.prompt("Vault name")?.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      return null;
    }
    return name;
  },
};

export default function App() {
  return <FluxApp runtime={webRuntime} windowControlsInset={0} />;
}
