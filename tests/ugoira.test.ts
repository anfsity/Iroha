import { describe, expect, test } from "vitest";
import {
  getUgoiraGifFilename,
  isUgoiraFormat,
} from "../src/ugoira.js";

describe("ugoira output", () => {
  test("maps ZIP output to GIF output", () => {
    expect(getUgoiraGifFilename("(123)sample@100ms.zip")).toBe(
      "(123)sample@100ms.gif",
    );
  });

  test("accepts only supported output formats", () => {
    expect(isUgoiraFormat("zip")).toBe(true);
    expect(isUgoiraFormat("gif")).toBe(true);
    expect(isUgoiraFormat("both")).toBe(true);
    expect(isUgoiraFormat("mp4")).toBe(false);
  });
});
