/**
 * Platform-specific application installer
 * 
 * Handles different update flows based on platform:
 * - macOS: Manual DMG installation (download → verify → open DMG → quit)
 * - Windows: Automatic NSIS installation (electron-updater → quitAndInstall)
 * - Linux: Automatic AppImage installation (electron-updater → restart)
 */

import { app, shell } from "electron";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

export type InstallerPlatform = "darwin" | "win32" | "linux";
export type InstallerState = "verifying" | "opening" | "installing";

export interface InstallerCallbacks {
  onStateChange: (state: InstallerState, metadata?: Record<string, unknown>) => void;
  onError: (error: Error) => void;
}

/**
 * Verifies a DMG file by checking its existence and optionally SHA256 checksum
 * Expected checksum format in release: FLUX-0.0.1-arm64.dmg.blockmap or release notes
 */
async function verifyDMGChecksum(
  dmgPath: string,
  expectedChecksum?: string
): Promise<boolean> {
  try {
    // First verify the file exists and is readable
    await fs.access(dmgPath);

    if (!expectedChecksum) {
      return true; // No checksum provided, just verify file exists
    }

    // Calculate SHA256 of the DMG
    const fileContent = await fs.readFile(dmgPath);
    const hash = crypto.createHash("sha256").update(fileContent).digest("hex");

    return hash.toLowerCase() === expectedChecksum.toLowerCase();
  } catch (error) {
    console.error("DMG verification failed:", error);
    return false;
  }
}

/**
 * Platform-agnostic installation dispatcher
 */
export async function installUpdate(
  platform: InstallerPlatform,
  callbacks: InstallerCallbacks
): Promise<void> {
  try {
    switch (platform) {
      case "darwin":
        return await installUpdateMacOS(callbacks);
      case "win32":
        return await installUpdateWindows(callbacks);
      case "linux":
        return await installUpdateLinux(callbacks);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    callbacks.onError(err);
    throw err;
  }
}

/**
 * macOS installation: Download DMG → Verify → Open DMG → Quit Flux
 * This is a semi-automatic flow because unsigned builds can't use Squirrel.Mac
 *
 * User experience:
 * 1. Download complete → DMG verified
 * 2. User clicks "Install"
 * 3. DMG opens in Finder
 * 4. User drags Flux.app to Applications
 * 5. macOS asks to replace existing app
 * 6. Done!
 */
async function installUpdateMacOS(callbacks: InstallerCallbacks): Promise<void> {
  try {
    // Get the cached DMG path from electron-updater's temp directory
    const updateCachePath = path.join(
      app.getPath("temp"),
      "electron-updater"
    );

    // Find the most recent DMG in the cache
    let dmgPath: string | null = null;
    try {
      const files = await fs.readdir(updateCachePath);
      const dmgFiles = files.filter((f) => f.endsWith(".dmg"));
      
      if (dmgFiles.length > 0) {
        // Sort by modification time (newest first)
        const filesWithStats = await Promise.all(
          dmgFiles.map(async (f) => {
            const fullPath = path.join(updateCachePath, f);
            const stats = await fs.stat(fullPath);
            return { path: fullPath, mtime: stats.mtime.getTime() };
          })
        );
        
        filesWithStats.sort((a, b) => b.mtime - a.mtime);
        dmgPath = filesWithStats[0].path;
      }
    } catch (e) {
      console.warn("Could not find DMG in cache:", e);
    }

    if (!dmgPath) {
      throw new Error("Update file not found. Please download the update again.");
    }

    // Verify the DMG
    callbacks.onStateChange("verifying");
    const isValid = await verifyDMGChecksum(dmgPath);

    if (!isValid) {
      throw new Error("Verification failed: Update package is corrupted.");
    }

    // Open the DMG
    callbacks.onStateChange("opening");
    const error = await shell.openPath(dmgPath);

    if (error) {
      throw new Error(`Failed to open installer: ${error}`);
    }

    // Give the system time to open Finder before quitting
    // This ensures the DMG opener completes before Flux closes
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Now quit Flux
    app.quit();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw err;
  }
}

/**
 * Windows installation: Use electron-updater with NSIS
 * The NSIS installer handles the actual application replacement
 *
 * User experience:
 * 1. Download complete
 * 2. User clicks "Install"
 * 3. NSIS runs silently
 * 4. Flux closes and is replaced
 * 5. Flux 0.0.2 launches
 */
async function installUpdateWindows(callbacks: InstallerCallbacks): Promise<void> {
  callbacks.onStateChange("installing");
  
  // For Windows with NSIS, electron-updater handles everything
  // The main process will call this after download-progress/update-downloaded
  // autoUpdater.quitAndInstall() is called after this function returns
  
  // This is a no-op because the IPC handler manages the quit/install flow
  // but we're keeping it for platform consistency
}

/**
 * Linux installation: Use electron-updater with AppImage
 * Replaces the AppImage and restarts
 *
 * User experience:
 * 1. Download complete
 * 2. User clicks "Install"
 * 3. New AppImage replaces old one
 * 4. Flux closes and relaunches
 * 5. Flux 0.0.2 launches
 */
async function installUpdateLinux(callbacks: InstallerCallbacks): Promise<void> {
  callbacks.onStateChange("installing");

  // For Linux with AppImage, electron-updater handles everything
  // Similar to Windows, this is managed by the IPC handler
  // autoUpdater.quitAndInstall() is called after this function returns
}

/**
 * Get the appropriate installer for this platform
 */
export function getPlatformInstaller(): InstallerPlatform {
  const platform = process.platform as InstallerPlatform;
  
  if (!["darwin", "win32", "linux"].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  
  return platform;
}
