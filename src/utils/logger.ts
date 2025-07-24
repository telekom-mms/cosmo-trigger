import { ConsoleHandler, getLogger, LogRecord, setup } from "log";

// ANSI color codes for log levels and formatting.
// These codes are used to add colors to log messages for better readability in the console.
const colors: Record<string, string> = {
  DEBUG: "\x1b[36m", // Cyan
  INFO: "\x1b[32m", // Green
  WARNING: "\x1b[33m", // Yellow
  ERROR: "\x1b[31m", // Red
  CRITICAL: "\x1b[41m\x1b[37m", // White on Red background
  MESSAGE: "\x1b[97m", // White
  RESET: "\x1b[0m",
};

const shouldUseColors = Deno.build.os !== "windows";

/**
 * Custom formatter function for log messages.
 *
 * This function formats log messages with colors on Unix systems and plain text on Windows.
 * It includes:
 * - A timestamp in ISO format.
 * - The log level (e.g., DEBUG, INFO) with appropriate colors (if supported).
 * - The main log message.
 *
 * @param logRecord - The log record containing the log details.
 * @returns A formatted string with colors for console output (Unix) or plain text (Windows).
 */
function colorFormatter(logRecord: LogRecord): string {
  if (shouldUseColors) {
    const levelColor = colors[logRecord.levelName] || "";
    const messageColor = colors.MESSAGE;
    const reset = colors.RESET;

    return `${messageColor}[${logRecord.datetime.toISOString()}]${reset} ` +
      `[${levelColor}${logRecord.levelName}${reset}] ` +
      `${messageColor}${logRecord.msg}${reset}`;
  } else {
    // Plain text format for Windows
    return `[${logRecord.datetime.toISOString()}] ` +
      `[${logRecord.levelName}] ` +
      `${logRecord.msg}`;
  }
}

/**
 * Logger setup configuration.
 *
 * - Defines a console handler with the custom formatter for colored log messages.
 * - Sets the default log level to "DEBUG" for detailed logging.
 * - Configures the logger to use the console handler for output.
 */
setup({
  handlers: {
    console: new ConsoleHandler("DEBUG", {
      formatter: colorFormatter,
    }),
  },
  loggers: {
    default: {
      level: "DEBUG",
      handlers: ["console"],
    },
  },
});

/**
 * Utility function to safely log errors regardless of their type.
 *
 * @param message - The context message to prefix the error.
 * @param error - The error object (can be any type).
 */
export function logError(message: string, error: unknown): void {
  if (error instanceof Error) {
    logger.error(`${message}: ${error.message}`);
  } else {
    logger.error(`${message}: ${String(error)}`);
  }
}

/**
 * Logger instance for application-wide logging.
 *
 * This logger can be imported and used throughout the application
 * to log messages at various levels (e.g., DEBUG, INFO, WARNING, ERROR).
 */
const logger = getLogger();
export { logger };
