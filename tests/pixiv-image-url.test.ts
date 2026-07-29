/**
 * Copyright (C) 2026 Anfsity
 */

import { describe, expect, test } from "vitest";
import { replacePixivImageUrl } from "../src/pixiv-image-url.js";

describe("Pixiv image URL source", () => {
  const originUrl =
    "https://i.pximg.net/img-original/img/2026/01/01/00/00/00/1234567_p0.jpg?foo=bar";

  test("replaces only the Pixiv image hostname", () => {
    expect(replacePixivImageUrl(originUrl, "pixivcat")).toBe(
      "https://i.pixiv.cat/img-original/img/2026/01/01/00/00/00/1234567_p0.jpg?foo=bar",
    );
  });

  test("keeps the original URL for direct downloads", () => {
    expect(replacePixivImageUrl(originUrl, "direct")).toBe(originUrl);
  });

  test("does not rewrite unrelated hosts", () => {
    const url = "https://example.test/image.jpg?source=i.pximg.net";
    expect(replacePixivImageUrl(url, "pixivcat")).toBe(url);
  });
});
