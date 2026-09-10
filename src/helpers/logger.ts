/**
 * Minimal leveled logger. Debug output (request/response tracing) is opt-in via
 * `DEBUG=pw:*` so default test runs stay quiet; CI logs stay readable.
 */
const debugEnabled = /pw:\*|pw:api/.test(process.env.DEBUG ?? '');

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug(message: string, meta?: unknown): void {
    if (!debugEnabled) return;
    console.log(`[${timestamp()}] [debug] ${message}`, meta ?? '');
  },
  info(message: string, meta?: unknown): void {
    console.log(`[${timestamp()}] [info] ${message}`, meta ?? '');
  },
  warn(message: string, meta?: unknown): void {
    console.warn(`[${timestamp()}] [warn] ${message}`, meta ?? '');
  },
  error(message: string, meta?: unknown): void {
    console.error(`[${timestamp()}] [error] ${message}`, meta ?? '');
  },
};
