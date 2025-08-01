import { failure, NetworkError, Result, success } from "src/types/result.ts";
import { logError } from "src/utils/logger.ts";
import { HttpResponse } from "src/types/http.ts";

/**
 * Consumes response body completely to free resources and prevent memory leaks.
 * This ensures proper cleanup of response streams and associated resources.
 *
 * @param response - The HTTP response to consume.
 */
async function consumeResponseBody(response: Response): Promise<void> {
  try {
    if (response.bodyUsed) {
      return;
    }

    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      await response.text();
    }
  } catch {
    // Ignore consumption errors
  }
}

/**
 * Processes successful HTTP response into HttpResponse object.
 *
 * @template T - The type of the response data.
 * @param response - The HTTP response object.
 * @param data - The parsed response data.
 * @returns HttpResponse object with data and status.
 */
function processSuccessResponse<T>(
  response: Response,
  data: T,
): HttpResponse<T> {
  const status = response.status;

  const result: HttpResponse<T> = { data, status };

  return result;
}

/**
 * Creates a NetworkError from caught exception.
 *
 * @param err - The caught error or exception.
 * @param url - The URL that was being fetched.
 * @returns NetworkError with appropriate message and status code.
 */
function createNetworkError(err: unknown, url: string): NetworkError {
  logError(`Failed to fetch from ${url}:`, err);

  if (err instanceof TypeError && err.message.includes("JSON")) {
    return new NetworkError("Invalid JSON response", 0);
  }

  return new NetworkError(
    err instanceof Error ? err.message : "Network request failed",
  );
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
  let response: Response | undefined;
  try {
    response = await fetch(url, options);

    if (!response.ok) {
      const status = response.status;
      await consumeResponseBody(response);

      return failure(new NetworkError(`HTTP error! status: ${status}`, status));
    }

    const data = await response.json();

    const result = processSuccessResponse(response, data);

    return success(result);
  } catch (err) {
    if (response && !response.bodyUsed) {
      await consumeResponseBody(response);
    }

    return failure(createNetworkError(err, url));
  } finally {
    response = undefined;
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
