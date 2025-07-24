/**
 * Union type representing either a successful or failed operation result.
 * This provides a type-safe way to handle operations that can fail without throwing exceptions.
 *
 * @template T - The type of the data returned on success.
 * @template E - The type of the error returned on failure (defaults to Error).
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Creates a successful Result containing the provided data.
 *
 * @template T - The type of the data.
 * @param data - The data to wrap in a success result.
 * @returns A Result indicating success with the provided data.
 */
export function success<T>(data: T): Result<T, never> {
  return { success: true, data };
}

/**
 * Creates a failed Result containing the provided error.
 *
 * @template E - The type of the error.
 * @param error - The error to wrap in a failure result.
 * @returns A Result indicating failure with the provided error.
 */
export function failure<E>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Type guard to check if a Result represents success.
 *
 * @template T - The type of the data in the success result.
 * @template E - The type of the error in the failure result.
 * @param result - The Result to check.
 * @returns True if the result represents success, false otherwise.
 */
export function isSuccess<T, E>(
  result: Result<T, E>,
): result is { success: true; data: T } {
  return result.success;
}

/**
 * Type guard to check if a Result represents failure.
 *
 * @template T - The type of the data in the success result.
 * @template E - The type of the error in the failure result.
 * @param result - The Result to check.
 * @returns True if the result represents failure, false otherwise.
 */
export function isFailure<T, E>(
  result: Result<T, E>,
): result is { success: false; error: E } {
  return !result.success;
}

/**
 * Custom error class for validation failures.
 * Used when input data fails validation checks.
 */
export class ValidationError extends Error {
  /**
   * Creates a new ValidationError.
   *
   * @param message - The error message describing what validation failed.
   * @param field - Optional field name that failed validation.
   */
  constructor(message: string, public field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Custom error class for network-related failures.
 * Used when HTTP requests or network operations fail.
 */
export class NetworkError extends Error {
  /**
   * Creates a new NetworkError.
   *
   * @param message - The error message describing what network operation failed.
   * @param statusCode - Optional HTTP status code if applicable.
   */
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * Custom error class for configuration-related failures.
 * Used when required environment variables are missing or invalid.
 */
export class ConfigurationError extends Error {
  /**
   * Creates a new ConfigurationError.
   *
   * @param message - The error message describing what configuration issue occurred.
   * @param missingKeys - Optional array of missing configuration keys.
   */
  constructor(message: string, public missingKeys?: string[]) {
    super(message);
    this.name = "ConfigurationError";
  }
}
