import pino from "pino";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Singleton root logger
// ---------------------------------------------------------------------------
let _logger: pino.Logger | null = null;

function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino({
      level: LOG_LEVEL,
      ...(IS_PRODUCTION
        ? {}
        : {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss",
                ignore: "pid,hostname",
              },
            },
          }),
    });
  }
  return _logger;
}

/** Root logger instance. */
export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    return (getLogger() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * Create a child logger scoped to a module with optional extra context.
 *
 * @example
 *   const log = createLogger("pipeline", { submissionId: "sub-123" });
 *   log.info("starting");
 */
export function createLogger(
  module: string,
  context?: Record<string, unknown>,
): pino.Logger {
  return getLogger().child({ module, ...context });
}

/** Reset the singleton — primarily for testing. */
export function resetLogger(): void {
  _logger = null;
}
