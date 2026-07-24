import logger from "./logger.js";

export default function logError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  logger.error("cli", "error.unhandled", "Unhandled error", {
    error,
    context,
  });
}
