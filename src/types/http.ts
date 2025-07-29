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
