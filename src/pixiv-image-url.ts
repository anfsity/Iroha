export type ImageSource = "direct" | "pixivcat";

export function isImageSource(value: unknown): value is ImageSource {
  return value === "direct" || value === "pixivcat";
}

export function replacePixivImageUrl(
  imageUrl: string,
  source: ImageSource,
): string {
  if (source === "direct") return imageUrl;

  const url = new URL(imageUrl);
  if (url.hostname === "i.pximg.net") {
    url.hostname = "i.pixiv.cat";
  }
  return url.href;
}
