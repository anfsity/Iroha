import { afterEach, describe, expect, test, vi } from "vitest";
import appState from "../src/appState.js";
import { isNsfwIllust } from "../src/illust-filter.js";
import Illustrator from "../src/illustrator.js";

const makeIllust = (x_restrict?: number): PixivIllustJSON => ({
  id: 123,
  title: "sample",
  type: "illust",
  ...(x_restrict === undefined ? {} : { x_restrict }),
  meta_single_page: {
    original_image_url: "https://i.pximg.net/img-original/sample.jpg",
  },
  meta_pages: [],
});

describe("NSFW illustration filtering", () => {
  afterEach(() => {
    appState.filterNsfw = false;
    vi.restoreAllMocks();
  });

  test("recognizes R-18 and R-18G metadata", () => {
    expect(isNsfwIllust(makeIllust(0))).toBe(false);
    expect(isNsfwIllust(makeIllust(1))).toBe(true);
    expect(isNsfwIllust(makeIllust(2))).toBe(true);
    expect(isNsfwIllust(makeIllust())).toBe(false);
  });

  test("skips a restricted illustration before URL conversion", async () => {
    appState.filterNsfw = true;
    const Illust = (await import("../src/illustration.js")).default;

    await expect(Illust.getIllusts(makeIllust(1))).resolves.toEqual([]);
  });

  test("keeps restricted illustrations when filtering is disabled", async () => {
    const Illust = (await import("../src/illustration.js")).default;

    await expect(Illust.getIllusts(makeIllust(2))).resolves.toHaveLength(1);
  });

  test("keeps pagination alive after a page is filtered", async () => {
    appState.filterNsfw = true;
    const requestUrl = vi.fn().mockResolvedValue({
      illusts: [],
      next_url: null,
    });
    Illustrator.setPixiv({
      userIllusts: vi.fn().mockResolvedValue({
        illusts: [makeIllust(1)],
        next_url: "next-page",
      }),
      requestUrl,
    } as any);

    const illustrator = new Illustrator(456);
    await expect(illustrator.illusts()).resolves.toEqual([]);
    expect(illustrator.lastPageSkippedNsfw).toBe(true);
    expect(illustrator.hasNext("illust")).toBe(true);

    await expect(illustrator.illusts()).resolves.toEqual([]);
    expect(requestUrl).toHaveBeenCalledWith("next-page");
    expect(illustrator.hasNext("illust")).toBe(false);
  });
});
