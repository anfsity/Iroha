/**
 * Copyright (C) 2026 Anfsity
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import Illustrator from "../src/illustrator.js";
import {
  DEFAULT_ILLUST_FILTER,
  isIllustAllowed,
  isIllustFilterActive,
} from "../src/illust-filter.js";
import { DEFAULT_ILLUST_POLICY } from "../src/illust-policy.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");

const makeIllust = (
  overrides: Partial<PixivIllustJSON> = {},
): PixivIllustJSON => ({
  id: 123,
  title: "sample",
  type: "illust",
  page_count: 1,
  width: 3840,
  height: 2160,
  create_date: "2024-01-01T00:00:00.000Z",
  total_view: 4000,
  meta_single_page: {
    original_image_url: "https://i.pximg.net/img-original/sample.jpg",
  },
  meta_pages: [],
  ...overrides,
});

describe("illustration filtering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("allows recent works regardless of their view count", () => {
    const config = {
      ...DEFAULT_ILLUST_FILTER,
      enabled: true,
      minViews: 4000,
      recentMonths: 12,
    };

    expect(
      isIllustAllowed(
        makeIllust({
          create_date: "2026-01-01T00:00:00.000Z",
          total_view: 1,
        }),
        config,
        NOW,
      ),
    ).toBe(true);
  });

  test("uses the view threshold for older works", () => {
    const config = {
      ...DEFAULT_ILLUST_FILTER,
      enabled: true,
      minViews: 4000,
      recentMonths: 12,
    };
    const oldDate = "2024-01-01T00:00:00.000Z";

    expect(
      isIllustAllowed(
        makeIllust({ create_date: oldDate, total_view: 3999 }),
        config,
        NOW,
      ),
    ).toBe(false);
    expect(
      isIllustAllowed(
        makeIllust({ create_date: oldDate, total_view: 4000 }),
        config,
        NOW,
      ),
    ).toBe(true);
  });

  test("treats the recent window as calendar months", () => {
    const config = {
      ...DEFAULT_ILLUST_FILTER,
      enabled: true,
      minViews: 4000,
      recentMonths: 1,
    };
    const now = new Date("2026-03-31T00:00:00.000Z");

    expect(
      isIllustAllowed(
        makeIllust({
          create_date: "2026-02-28T00:00:00.000Z",
          total_view: 1,
        }),
        config,
        now,
      ),
    ).toBe(true);
    expect(
      isIllustAllowed(
        makeIllust({
          create_date: "2026-02-27T23:59:59.000Z",
          total_view: 1,
        }),
        config,
        now,
      ),
    ).toBe(false);
  });

  test("can disable the quality filter independently", () => {
    expect(
      isIllustAllowed(
        makeIllust({ create_date: "2020-01-01T00:00:00.000Z", total_view: 1 }),
        { ...DEFAULT_ILLUST_FILTER, enabled: false },
        NOW,
      ),
    ).toBe(true);
    expect(isIllustFilterActive(DEFAULT_ILLUST_FILTER)).toBe(false);
  });

  test("recognizes desktop wallpaper ratios", () => {
    const config = {
      ...DEFAULT_ILLUST_FILTER,
      wallpaperMode: "desktop" as const,
    };

    expect(isIllustAllowed(makeIllust(), config, NOW)).toBe(true);
    expect(
      isIllustAllowed(makeIllust({ width: 100, height: 60 }), config, NOW),
    ).toBe(true);
    expect(
      isIllustAllowed(makeIllust({ width: 100, height: 100 }), config, NOW),
    ).toBe(false);
    expect(
      isIllustAllowed(makeIllust({ width: 1080, height: 1920 }), config, NOW),
    ).toBe(false);
    expect(isIllustAllowed(makeIllust({ page_count: 2 }), config, NOW)).toBe(
      false,
    );
  });

  test("recognizes mobile wallpaper dimensions", () => {
    const config = {
      ...DEFAULT_ILLUST_FILTER,
      wallpaperMode: "mobile" as const,
    };

    expect(
      isIllustAllowed(makeIllust({ width: 1080, height: 2400 }), config, NOW),
    ).toBe(true);
    expect(
      isIllustAllowed(makeIllust({ width: 1920, height: 1080 }), config, NOW),
    ).toBe(false);
    expect(
      isIllustAllowed(
        makeIllust({ type: "ugoira", width: 1080, height: 2400 }),
        config,
        NOW,
      ),
    ).toBe(false);
  });

  test("continues pagination after a filtered page", async () => {
    const requestUrl = vi.fn().mockResolvedValue({
      illusts: [makeIllust({ total_view: 4000 })],
      next_url: null,
    });
    Illustrator.setPixiv({
      userIllusts: vi.fn().mockResolvedValue({
        illusts: [makeIllust({ total_view: 1 })],
        next_url: "next-page",
      }),
      requestUrl,
    } as any);

    const illustrator = new Illustrator(456, "", [], undefined, {
      ...DEFAULT_ILLUST_POLICY,
      filter: {
        ...DEFAULT_ILLUST_FILTER,
        enabled: true,
        recentMonths: 0,
      },
    });

    await expect(illustrator.illusts()).resolves.toEqual([]);
    expect(illustrator.lastPageSkipped).toBe(true);
    await expect(illustrator.illusts()).resolves.toHaveLength(1);
    expect(requestUrl).toHaveBeenCalledWith("next-page");
  });
});
