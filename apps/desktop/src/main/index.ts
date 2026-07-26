import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type WebContents } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "path";

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
const vaultEventStreams = new Map<string, AbortController>();
const closeReadyWindows = new Set<number>();
const closePendingWindows = new Set<number>();
let quitAfterFlush = false;
let allowQuit = false;

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);
const externalBackendOrigin = process.env.FLUX_BACKEND_URL;
let backendOrigin = externalBackendOrigin ?? "";
let backendToken = "";
let backendHeartbeat: ReturnType<typeof setInterval> | null = null;
let backendStartup: Promise<void> | null = null;
const backendStartupAttempts = 300;

function fluxAppDataDirectory() {
  return process.env.FLUX_APP_DATA_DIR ?? path.join(app.getPath("appData"), "Flux");
}

interface RuntimeDescriptor {
  pid: number;
  origin: string;
  token: string;
  protocol: number;
  version: string;
}

async function attachPublishedBackend() {
  try {
    const descriptor = JSON.parse(
      await readFile(path.join(fluxAppDataDirectory(), "runtime", "daemon.json"), "utf8")
    ) as Partial<RuntimeDescriptor>;
    const origin = new URL(descriptor.origin ?? "");
    if (
      descriptor.protocol !== 1 ||
      !Number.isInteger(descriptor.pid) ||
      descriptor.pid! <= 0 ||
      !descriptor.token ||
      descriptor.version !== app.getVersion() ||
      origin.protocol !== "http:" ||
      (origin.hostname !== "127.0.0.1" && origin.hostname !== "::1")
    ) {
      return false;
    }
    backendOrigin = origin.origin;
    backendToken = descriptor.token;
    return true;
  } catch {
    return false;
  }
}

async function stopStalePublishedBackend(force = false) {
  try {
    const descriptor = JSON.parse(
      await readFile(path.join(fluxAppDataDirectory(), "runtime", "daemon.json"), "utf8")
    ) as Partial<RuntimeDescriptor>;
    if (!force && !isDev && descriptor.version === app.getVersion()) return;
    if (!Number.isInteger(descriptor.pid) || descriptor.pid! <= 0 || !descriptor.token) return;
    const origin = new URL(descriptor.origin ?? "");
    if (
      origin.protocol !== "http:" ||
      (origin.hostname !== "127.0.0.1" && origin.hostname !== "::1")
    ) {
      return;
    }
    const response = await fetch(`${origin.origin}/api/v1/status`, {
      headers: { "X-Flux-Desktop-Token": descriptor.token },
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return;
    const status = (await response.json()) as { version?: unknown };
    if (status.version !== descriptor.version) return;
    process.kill(descriptor.pid!, "SIGTERM");
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        process.kill(descriptor.pid!, 0);
      } catch {
        break;
      }
    }
  } catch {
    // No stale runtime is published.
  }
  backendOrigin = "";
  backendToken = "";
}

function backendHeaders() {
  return backendToken ? { "X-Flux-Desktop-Token": backendToken } : undefined;
}

function streamKey(sender: WebContents, watcherId: string) {
  return `${sender.id}:${watcherId}`;
}

async function waitForRetry(signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

async function consumeVaultEvents(
  sender: WebContents,
  watcherId: string,
  vaultId: string,
  signal: AbortSignal
) {
  while (!signal.aborted && !sender.isDestroyed()) {
    try {
      const response = await fetch(
        `${backendOrigin}/api/v1/vaults/${encodeURIComponent(vaultId)}/events`,
        { signal, headers: backendHeaders() }
      );
      if (!response.ok || !response.body) {
        throw new Error(`Vault event stream failed with status ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const eventName = frame
            .split("\n")
            .find((line) => line.startsWith("event:"))
            ?.slice(6)
            .trim();
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (eventName === "revision" && data) {
            const payload = JSON.parse(data) as { revision?: unknown };
            if (typeof payload.revision === "number" && !sender.isDestroyed()) {
              sender.send(`vault-revision:${watcherId}`, payload);
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (signal.aborted || sender.isDestroyed()) return;
      const message = error instanceof Error ? error.message : String(error);
      sender.send(`vault-revision-error:${watcherId}`, message);
    }
    await waitForRetry(signal);
  }
}

async function backendReady() {
  if (!backendOrigin) return false;
  try {
    const response = await fetch(`${backendOrigin}/api/v1/status`, { headers: backendHeaders() });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBackend() {
  if (externalBackendOrigin) {
    if (await backendReady()) return;
    throw new Error(`Configured FLUX backend is unavailable at ${externalBackendOrigin}`);
  }

  if ((await attachPublishedBackend()) && (await backendReady())) return;
  await stopStalePublishedBackend(Boolean(backendOrigin));

  const backendEnvironment = {
    ...process.env,
    ENVIRONMENT: "desktop",
    HOST: "127.0.0.1",
    PORT: "0",
    FLUX_APP_DATA_DIR: fluxAppDataDirectory(),
    FLUX_DESKTOP_TOKEN: "",
    FLUX_DAEMON_IDLE_TIMEOUT: "2m",
  };
  if (isDev) {
    // Main-process reload restarts daemon, so go run recompiles backend changes.
    const serverDirectory = path.resolve(currentDirectory, "../../../server");
    backendProcess = spawn(
      process.env.GO_BIN ?? "/usr/local/go/bin/go",
      ["-C", serverDirectory, "run", "-tags", "sqlite_fts5", "."],
      {
        env: backendEnvironment,
        stdio: "inherit",
        detached: true,
      }
    );
  } else {
    backendProcess = spawn(path.join(process.resourcesPath, "flux-server"), [], {
      env: backendEnvironment,
      stdio: "inherit",
      detached: true,
    });
  }
  backendProcess.unref();
  for (let attempt = 0; attempt < backendStartupAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if ((await attachPublishedBackend()) && (await backendReady())) return;
  }
  throw new Error("FLUX backend did not become ready");
}

function resumeQuitIfReady() {
  if (!quitAfterFlush || closePendingWindows.size > 0 || allowQuit) return;
  allowQuit = true;
  app.quit();
}

function finishWindowFlush(window: BrowserWindow, windowId: number) {
  if (!closePendingWindows.delete(windowId)) return;
  if (quitAfterFlush) {
    resumeQuitIfReady();
    return;
  }
  if (window.isDestroyed()) return;
  closeReadyWindows.add(windowId);
  window.close();
}

function requestWindowFlush(window: BrowserWindow, windowId: number) {
  if (closePendingWindows.has(windowId)) return;
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  closePendingWindows.add(windowId);
  window.webContents.send("flux-before-close");
  const timeout = setTimeout(() => finishWindowFlush(window, windowId), 5_000);
  timeout.unref();
}

function createWindow(targetUrl?: string) {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(currentDirectory, "preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: "hiddenInset",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1a1a1a" : "#e8e8e8",
  });

  if (process.platform === "darwin") {
    window.setWindowButtonVisibility(true);
    window.setWindowButtonPosition({ x: 14, y: 18 });
  }

  if (devServerUrl) {
    void window.loadURL(targetUrl ?? devServerUrl);
  } else {
    if (targetUrl?.startsWith("file:")) void window.loadFile(fileURLToPath(targetUrl));
    else void window.loadFile(path.join(currentDirectory, "../dist/index.html"));
  }

  if (!mainWindow) mainWindow = window;
  const windowId = window.webContents.id;
  window.on("close", (event) => {
    if (allowQuit || closeReadyWindows.delete(windowId)) return;
    if (window.webContents.isDestroyed()) return;
    event.preventDefault();
    requestWindowFlush(window, windowId);
  });
  window.on("closed", () => {
    closePendingWindows.delete(windowId);
    closeReadyWindows.delete(windowId);
    if (mainWindow === window) mainWindow = null;
    resumeQuitIfReady();
  });

  return window;
}

app.whenReady().then(async () => {
  backendStartup = ensureBackend();
  createWindow();
  await backendStartup;
  backendHeartbeat = setInterval(() => void backendReady(), 30_000);
  backendHeartbeat.unref();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  quitAfterFlush = true;
  for (const window of BrowserWindow.getAllWindows()) {
    requestWindowFlush(window, window.webContents.id);
  }
  resumeQuitIfReady();
});

app.on("will-quit", () => {
  // Shared runtime may still serve MCP clients after Electron closes.
  if (backendHeartbeat) clearInterval(backendHeartbeat);
  backendHeartbeat = null;
  backendProcess = null;
});

ipcMain.handle("ping", async () => {
  return "pong";
});

ipcMain.handle("get-window-id", (event) => {
  return mainWindow?.webContents.id === event.sender.id ? "main" : `window-${event.sender.id}`;
});

ipcMain.on("flux-close-ready", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return;
  finishWindowFlush(window, event.sender.id);
});

ipcMain.handle("select-vault-directory", async (_event, mode: unknown) => {
  if (mode !== "open" && mode !== "create") throw new TypeError("Invalid vault selection mode");
  const options = {
    title: mode === "create" ? "Create or choose an empty vault folder" : "Open vault folder",
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
  };
  const result = await (mainWindow
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options));
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("flux-fetch", async (_event, request: unknown) => {
  await backendStartup;
  if (!request || typeof request !== "object") throw new TypeError("Invalid Flux request");
  const value = request as { url?: unknown; method?: unknown; body?: unknown };
  if (typeof value.url !== "string" || !value.url.startsWith("/api/v1/")) {
    throw new TypeError("Invalid Flux API URL");
  }
  const method = typeof value.method === "string" ? value.method : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new TypeError("Invalid Flux API method");
  }
  const response = await fetch(new URL(value.url, backendOrigin), {
    method,
    headers: { "Content-Type": "application/json", ...backendHeaders() },
    body: typeof value.body === "string" ? value.body : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "application/json";
  const bytes = Buffer.from(await response.arrayBuffer());
  const binary = !contentType.startsWith("application/json") && !contentType.startsWith("text/");
  return {
    status: response.status,
    body: binary ? "" : bytes.toString("utf8"),
    bodyBase64: binary ? bytes.toString("base64") : undefined,
    contentType,
  };
});

ipcMain.on("watch-vault-revision", (event, request: unknown) => {
  if (!request || typeof request !== "object") return;
  const value = request as { watcherId?: unknown; vaultId?: unknown };
  if (
    typeof value.watcherId !== "string" ||
    value.watcherId.length > 100 ||
    typeof value.vaultId !== "string" ||
    value.vaultId.length > 100
  ) {
    return;
  }
  const key = streamKey(event.sender, value.watcherId);
  vaultEventStreams.get(key)?.abort();
  const controller = new AbortController();
  vaultEventStreams.set(key, controller);
  event.sender.once("destroyed", () => controller.abort());
  void consumeVaultEvents(event.sender, value.watcherId, value.vaultId, controller.signal).finally(
    () => {
      if (vaultEventStreams.get(key) === controller) vaultEventStreams.delete(key);
    }
  );
});

ipcMain.on("unwatch-vault-revision", (event, watcherId: unknown) => {
  if (typeof watcherId !== "string") return;
  const key = streamKey(event.sender, watcherId);
  vaultEventStreams.get(key)?.abort();
  vaultEventStreams.delete(key);
});

ipcMain.handle("export-pdf", async (event, options: unknown) => {
  if (!options || typeof options !== "object") throw new TypeError("Invalid PDF options");
  const value = options as Record<string, unknown>;
  if (
    typeof value.title !== "string" ||
    (value.pageSize !== "A4" && value.pageSize !== "Letter") ||
    typeof value.landscape !== "boolean" ||
    typeof value.marginMillimetres !== "number" ||
    typeof value.scale !== "number" ||
    value.marginMillimetres < 0 ||
    value.marginMillimetres > 50 ||
    value.scale < 0.5 ||
    value.scale > 2
  ) {
    throw new TypeError("Invalid PDF options");
  }
  const owner = BrowserWindow.fromWebContents(event.sender);
  const safeTitle = value.title.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
  const result = await (owner
    ? dialog.showSaveDialog(owner, {
        title: "Export PDF",
        defaultPath: `${safeTitle}.pdf`,
        buttonLabel: "Export",
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      })
    : dialog.showSaveDialog({
        title: "Export PDF",
        defaultPath: `${safeTitle}.pdf`,
        buttonLabel: "Export",
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      }));
  if (result.canceled || !result.filePath) return null;
  const data = await event.sender.printToPDF({
    scale: value.scale,
    printBackground: false,
    preferCSSPageSize: true,
    generateTaggedPDF: true,
    generateDocumentOutline: true,
  });
  await writeFile(result.filePath, data);
  return result.filePath;
});

ipcMain.handle("check-for-updates", async () => {
  if (app.isPackaged) {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { isDev, isPackaged: true, error: message };
    }
  }
  return { isDev, isPackaged: app.isPackaged };
});

ipcMain.handle("get-app-version", async () => {
  return app.getVersion();
});

ipcMain.handle("get-performance-stats", () => {
  const metrics = app.getAppMetrics();

  return metrics.reduce(
    (stats, processMetric) => ({
      cpuPercent: stats.cpuPercent + processMetric.cpu.percentCPUUsage,
      memoryMB: stats.memoryMB + processMetric.memory.workingSetSize / 1024,
    }),
    { cpuPercent: 0, memoryMB: 0 }
  );
});

ipcMain.handle("set-native-theme", (_event, theme: unknown) => {
  if (theme !== "dark" && theme !== "light" && theme !== "system") {
    throw new TypeError("Invalid native theme");
  }

  nativeTheme.themeSource = theme;
});

ipcMain.handle("open-window", (_event, target: unknown) => {
  if (typeof target !== "string") throw new TypeError("Invalid window URL");
  const url = new URL(target);
  if (isDev) {
    if (!devServerUrl || url.origin !== new URL(devServerUrl).origin) {
      throw new Error("Window URL must use the dev server origin");
    }
  } else if (url.protocol !== "file:") {
    throw new Error("Window URL must use the app bundle");
  }
  createWindow(target);
});
