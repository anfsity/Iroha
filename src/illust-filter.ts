/**
 * Copyright (C) 2026 Anfsity
 */

export function isNsfwIllust(
  illustJSON: Pick<PixivIllustJSON, "x_restrict">,
): boolean {
  return (illustJSON.x_restrict ?? 0) > 0;
}

export type WallpaperMode = "none" | "desktop" | "mobile";

export interface IllustFilterConfig {
  enabled: boolean;
  minViews: number;
  recentMonths: number;
  wallpaperMode: WallpaperMode;
}

export const DEFAULT_ILLUST_FILTER: IllustFilterConfig = {
  enabled: false,
  minViews: 4000,
  recentMonths: 12,
  wallpaperMode: "none",
};

const DESKTOP_MIN_RATIO = 1.5;
const DESKTOP_MAX_RATIO = 3.8;
const MOBILE_MIN_WIDTH = 720;
const MOBILE_MIN_HEIGHT = 1280;
const MOBILE_MIN_RATIO = 1.5;
const MOBILE_MAX_RATIO = 2.5;

export function isWallpaperMode(value: unknown): value is WallpaperMode {
  return value === "none" || value === "desktop" || value === "mobile";
}

export function isIllustFilterActive(config: IllustFilterConfig): boolean {
  return config.enabled || config.wallpaperMode !== "none";
}

export function isIllustAllowed(
  illustJSON: PixivIllustJSON,
  config: IllustFilterConfig,
  now: Date = new Date(),
): boolean {
  if (config.enabled && !passesQualityFilter(illustJSON, config, now)) {
    return false;
  }

  return (
    config.wallpaperMode === "none" ||
    isWallpaperIllust(illustJSON, config.wallpaperMode)
  );
}

function passesQualityFilter(
  illustJSON: PixivIllustJSON,
  config: IllustFilterConfig,
  now: Date,
): boolean {
  const views = illustJSON.total_view;
  const hasEnoughViews =
    typeof views === "number" &&
    Number.isFinite(views) &&
    views >= config.minViews;

  return hasEnoughViews || isRecentIllust(illustJSON.create_date, config, now);
}

function isRecentIllust(
  createDate: string | undefined,
  config: IllustFilterConfig,
  now: Date,
): boolean {
  if (!createDate || config.recentMonths <= 0) return false;

  const createdAt = Date.parse(createDate);
  if (!Number.isFinite(createdAt)) return false;

  return (
    createdAt >= subtractCalendarMonths(now, config.recentMonths).getTime()
  );
}

function subtractCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - Math.floor(months));

  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function isWallpaperIllust(
  illustJSON: PixivIllustJSON,
  mode: Exclude<WallpaperMode, "none">,
): boolean {
  if (illustJSON.type !== "illust" || illustJSON.page_count !== 1) {
    return false;
  }

  const { width, height } = illustJSON;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }

  const ratio = width / height;
  if (mode === "desktop") {
    return ratio >= DESKTOP_MIN_RATIO && ratio <= DESKTOP_MAX_RATIO;
  }

  const portraitRatio = height / width;
  return (
    width >= MOBILE_MIN_WIDTH &&
    height >= MOBILE_MIN_HEIGHT &&
    portraitRatio >= MOBILE_MIN_RATIO &&
    portraitRatio <= MOBILE_MAX_RATIO
  );
}
