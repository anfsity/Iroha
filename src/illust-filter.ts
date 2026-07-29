export function isNsfwIllust(
  illustJSON: Pick<PixivIllustJSON, "x_restrict">,
): boolean {
  return (illustJSON.x_restrict ?? 0) > 0;
}
