/**
 * Copyright (C) 2026 Anfsity
 */

import { describe, expect, test } from "vitest";
import {
  DEFAULT_CONFIG,
  getIllustPolicy,
  normalizeConfig,
} from "../src/config.js";

describe("application configuration", () => {
  test("migrates the legacy top-level ugoira format", () => {
    const config = normalizeConfig({
      ugoiraFormat: "gif",
      imageSource: "pixivcat",
      filterNsfw: true,
    });

    expect(config.download.ugoiraFormat).toBe("gif");
    expect(config.imageSource).toBe("pixivcat");
    expect(config.filterNsfw).toBe(true);
    expect(config).not.toHaveProperty("ugoiraFormat");
  });

  test("derives an explicit illustration policy from config", () => {
    const config = normalizeConfig({
      ...DEFAULT_CONFIG,
      download: { ...DEFAULT_CONFIG.download, ugoiraFormat: "both" },
      filterNsfw: true,
    });

    expect(getIllustPolicy(config, { ugoiraMeta: false })).toEqual({
      imageSource: "direct",
      filterNsfw: true,
      ugoiraMeta: false,
      ugoiraFormat: "both",
    });
  });
});
