/**
 * Represents the handle of a health server, including the necessary methods
 * and state for controlling and interacting with the server.
 */
export type HealthServerHandle = {
  shutdown: () => Promise<void>;
  readyState: {
    ready: boolean;
  };
  serverPromise: Promise<void>;
};

/**
 * Represents the health state of the service.
 * This is used to track the current readiness state of the service.
 */
export type HealthState = {
  ready: boolean;
};
