import { failure, NetworkError, Result, success } from "src/types/result.ts";
import { logError } from "src/utils/logger.ts";

/**
 * Represents an HTTP response with typed data and status information.
 *
 * @template T - The type of the response data.
 */
export interface HttpResponse<T> {
  /** The parsed response data */
  data: T;
  /** The HTTP status code */
  status: number;
}

/**
 * Makes an HTTP request and parses the response as JSON.
 * Returns a Result type for type-safe error handling.
 *
 * @template T - The expected type of the JSON response data.
 * @param url - The URL to fetch from.
 * @param options - Optional fetch configuration (headers, method, body, etc.).
 * @returns A Promise resolving to either success with HttpResponse or failure with NetworkError.
 *
 * @example
 * ```typescript
 * const result = await fetchJson<{ name: string }>('https://api.example.com/user');
 * if (isSuccess(result)) {
 *   console.log(result.data.data.name); // Type-safe access
 * }
 * ```
 */
export async function fetchJson<T>(
  url: string,
  options?: RequestInit,
): Promise<Result<HttpResponse<T>, NetworkError>> {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      return failure(
        new NetworkError(
          `HTTP error! status: ${response.status}`,
          response.status,
        ),
      );
    }

    const data = await response.json();

    return success({
      data,
      status: response.status,
    });
  } catch (err) {
    logError(`Failed to fetch from ${url}:`, err);

    if (err instanceof TypeError && err.message.includes("JSON")) {
      return failure(new NetworkError("Invalid JSON response", 0));
    }

    return failure(
      new NetworkError(
        err instanceof Error ? err.message : "Network request failed",
      ),
    );
  }
}

/**
 * Safely navigates nested object properties without throwing errors.
 * Returns null if any property in the path is undefined, null, or if the traversal fails.
 *
 * @template T - The expected type of the value at the end of the path.
 * @param obj - The object to navigate through.
 * @param path - Array of property keys representing the path to traverse.
 * @returns The value at the specified path, or null if navigation fails.
 *
 * @example
 * ```typescript
 * const data = { user: { profile: { name: "John" } } };
 * const name = safeGet<string>(data, ["user", "profile", "name"]); // "John"
 * const missing = safeGet<string>(data, ["user", "missing", "prop"]); // null
 * ```
 */
export function safeGet<T>(obj: unknown, path: string[]): T | null {
  let current: unknown = obj;

  for (const key of path) {
    if (current == null || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return (current ?? null) as T | null;
}
