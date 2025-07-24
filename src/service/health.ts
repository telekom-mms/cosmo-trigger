import { HealthServerHandle, HealthState } from "src/types/health-server.ts";
import { logger } from "src/utils/logger.ts";

/**
 * Shared health state object to track the readiness of the service.
 * Kubernetes can check the `/ready` endpoint to confirm service state.
 */
const healthState: HealthState = {
  ready: true,
};

/**
 * Set the service state to "ready". This is used when the service is fully initialized.
 */
export function setReady(): void {
  healthState.ready = true;
}

/**
 * Set the service state to "not ready". This is useful for Kubernetes to know when the service
 * is still initializing or should not receive traffic.
 */
export function setNotReady(): void {
  healthState.ready = false;
}

/**
 * A pure request handler for the health server. Exported for testability.
 * It returns a Response based on the request path and the provided health state.
 *
 * @param request - The incoming HTTP request.
 * @param state - The current health state of the application.
 * @returns A Response object.
 */
export function healthServerHandler(
  request: Request,
  state: HealthState,
): Response {
  const { pathname } = new URL(request.url);

  switch (pathname) {
    case "/ready":
      return new Response(null, {
        status: state.ready ? 204 : 503,
      });
    default:
      return new Response(null, { status: 404 });
  }
}

/**
 * Start a clean, silent, fully controlled health server.
 * No default Deno logs. Supports `/ready` and a 404 fallback.
 *
 * @param port - Valid port number for health server to listen on (validated during config loading).
 * @returns A handle to shut down the health server and check readiness state.
 */
export function startHealthServer(port: number): HealthServerHandle {
  logger.info(`Health server listening on port: ${port}`);

  const controller = new AbortController();
  const { signal } = controller;

  const server = Deno.serve(
    { port, signal, onListen: () => {} },
    (request) => healthServerHandler(request, healthState),
  );

  const serverPromise = server.finished.catch((err) => {
    if (!signal.aborted) {
      logger.error("Health server error:", err);
      throw err;
    }
  });

  return {
    shutdown: async (): Promise<void> => {
      logger.info("Shutting down health server...");
      controller.abort();
      try {
        await serverPromise;
        logger.info("Health server shutdown complete");
      } catch (err) {
        if (!signal.aborted) {
          logger.error("Error during health server shutdown:", err);
        }
      }
    },
    readyState: healthState,
    serverPromise,
  };
}
