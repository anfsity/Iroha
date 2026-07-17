/**
 * Protocol configuration persistence.
 *
 * Manages `protocol.json` in the iroha app data directory, storing the
 * current registration state and the ephemeral HTTP port used by the
 * OAuth code receiver.
 */

import fse from "fs-extra";
import path from "node:path";
import { getAppDataPath } from "../utils.js";

const CONFIG_FILE_DIR = getAppDataPath("iroha");
const CONFIG_FILE = path.resolve(CONFIG_FILE_DIR, "protocol.json");

export interface ProtocolConfig {
  registered: boolean;
  port: number;
}

const defaultConfig: ProtocolConfig = { registered: false, port: 0 };

function writeConfig(
  config: ProtocolConfig = defaultConfig,
): ProtocolConfig {
  fse.ensureDirSync(CONFIG_FILE_DIR);
  fse.writeJsonSync(CONFIG_FILE, config);
  return config;
}

function readConfig(): ProtocolConfig {
  return fse.readJsonSync(CONFIG_FILE) as ProtocolConfig;
}

function getConfig(): ProtocolConfig {
  try {
    return readConfig();
  } catch {
    return writeConfig();
  }
}

export const data: ProtocolConfig = getConfig();

export function modify(obj: Partial<ProtocolConfig>): ProtocolConfig {
  return writeConfig(Object.assign(data, obj));
}
