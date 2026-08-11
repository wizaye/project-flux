import { createClientStatePersistence, FluxApp, type FluxRuntime } from "@flux/app-core";
import { DesktopFluxClient } from "@flux/client-desktop";

const client = window.electronAPI ? new DesktopFluxClient(window.electronAPI) : null;
const statePersistence = client ? createClientStatePersistence(client) : undefined;

const desktopRuntime: FluxRuntime = {
  label: "Desktop",
  client,
  statePersistence,
  getWindowId: async () => window.electronAPI?.getWindowId() ?? "main",
  hideWindow: async () => window.electronAPI?.hideWindow(),
  getMCPServerCommand: async () =>
    window.electronAPI?.getMCPServerCommand() ?? { command: "", args: [] },
  onCommand: (handler) =>
    window.electronAPI?.onCommand((command) => {
      if (
        command === "search" ||
        command === "daily-today" ||
        command === "calendar" ||
        command === "settings"
      ) {
        handler(command);
      }
    }) ?? (() => undefined),
  setTheme: async (theme) => {
    await window.electronAPI?.setTheme(theme);
  },
  setMenuBarIconEnabled: async (enabled) => {
    await window.electronAPI?.setMenuBarIconEnabled(enabled);
  },
  connect: async () => {
    if (!window.electronAPI) return "Electron bridge unavailable";
    const response = await window.electronAPI.ping();
    return response === "pong" ? "Electron bridge connected" : response;
  },
  getPerformanceStats: async () => window.electronAPI?.getPerformanceStats() ?? null,
  openWindow: async (url) => window.electronAPI?.openWindow(url),
  openPublicationPreview: async (sitePath) =>
    window.electronAPI?.openPublicationPreview(sitePath),
  onBeforeShutdown: (handler) => window.electronAPI?.onBeforeClose(handler) ?? (() => undefined),
  exportPdf: async (options) => window.electronAPI?.exportPdf(options) ?? null,
  selectVaultDirectory: async (mode) => window.electronAPI?.selectVaultDirectory(mode) ?? null,
};

export default function App() {
  return <FluxApp runtime={desktopRuntime} />;
}
