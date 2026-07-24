import * as readline from "node:readline";

interface ActiveProgress {
  timer: NodeJS.Timeout;
  render: () => string | number;
}

let activeProgress: ActiveProgress | null = null;

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY);
}

function drawProgress(): void {
  if (!activeProgress || !isInteractive()) return;

  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(String(activeProgress.render()));
}

export function startProgress(render: () => string | number): NodeJS.Timeout {
  stopProgress();

  const timer = setInterval(drawProgress, 500);
  activeProgress = { timer, render };
  return timer;
}

export function stopProgress(timer?: NodeJS.Timeout): void {
  if (timer && activeProgress?.timer !== timer) {
    clearInterval(timer);
    return;
  }

  if (activeProgress) {
    clearInterval(activeProgress.timer);
    if (isInteractive()) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    activeProgress = null;
  }
}

/**
 * Clear the active progress line before a log record is written.
 * The return value is passed to resumeProgress after the record is written.
 */
export function suspendProgress(): boolean {
  if (!activeProgress || !isInteractive()) return false;

  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  return true;
}

export function resumeProgress(wasSuspended: boolean): void {
  if (wasSuspended) drawProgress();
}
