/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/protocol/index.js
 *
 * Windows custom-protocol (`pixiv://`) registration manager.
 *
 * On Windows, this module registers a custom URL protocol handler so
 * that clicking the Pixiv OAuth redirect link automatically sends the
 * authorization code back to the local receiver server, removing the
 * need for the user to manually copy-paste the code.
 *
 * On non-Windows platforms (or when `register-protocol-win32` is not
 * installed), every operation gracefully returns a safe default so that
 * callers never need platform checks.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Config from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* -------------------------------------------------------------------------- */
/*  Dynamic import of the optional Win32-only dependency.                     */
/* -------------------------------------------------------------------------- */

interface ProtocolModule {
  exists(name: string): Promise<boolean>;
  install(name: string, command: string): Promise<void>;
  uninstall(name: string): Promise<void>;
}

async function loadProtocolModule(): Promise<ProtocolModule | null> {
  if (process.platform !== "win32") return null;
  try {
    // `register-protocol-win32` is an optional dependency; it is only
    // available (and useful) on Windows.
    const mod = await import("register-protocol-win32");
    return (mod.default ?? mod) as ProtocolModule;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

const PROTOCOL_NAME = "pixiv";

export async function exists(): Promise<boolean> {
  const Protocol = await loadProtocolModule();
  if (!Protocol) return false;
  try {
    return await Protocol.exists(PROTOCOL_NAME);
  } catch {
    return false;
  }
}

export async function uninstall(): Promise<boolean> {
  const Protocol = await loadProtocolModule();
  if (!Protocol) return false;
  try {
    await Protocol.uninstall(PROTOCOL_NAME);
    Config.modify({ registered: false });
    return true;
  } catch {
    return false;
  }
}

export async function install(): Promise<boolean> {
  const Protocol = await loadProtocolModule();
  if (!Protocol) return false;

  const senderScript = path.resolve(__dirname, "sender.js");
  const cmd = `"${process.execPath}" "${senderScript}" "%1"`;

  try {
    await Protocol.install(PROTOCOL_NAME, cmd);
    Config.modify({ registered: true });
    return true;
  } catch {
    return false;
  }
}

export async function canInstall(): Promise<boolean> {
  const Protocol = await loadProtocolModule();
  if (!Protocol) return false;

  const isRegistered = await exists();
  if (typeof isRegistered !== "boolean") return false;

  // Don't install if the protocol is already registered by another app
  // (i.e. not registered by us but exists in the system).
  return !(!Config.data.registered && isRegistered);
}
