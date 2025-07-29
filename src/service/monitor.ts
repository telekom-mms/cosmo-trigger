import { type Config } from "config/config.ts";
import * as cosmos from "src/service/cosmos.ts";
import * as gitlab from "src/service/gitlab.ts";
import { ChainIdentity } from "src/types/chain-identity.ts";
import { MonitorState } from "src/types/monitor.ts";
import { logger } from "src/utils/logger.ts";

const LONG_POLL_INTERVAL_MS = 10_000;
const POST_UPGRADE_WAIT_MS = 600_000;
const ERROR_RETRY_INTERVAL_MS = 5_000;

/**
 * Creates a signal-aware delay that can be interrupted by AbortSignal.
 *
 * @param ms - Delay duration in milliseconds
 * @param signal - Optional AbortSignal for early termination
 * @returns Promise that resolves after delay or immediately if aborted
 */
function createSignalAwareDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeoutId = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

// Module-level state to persist across recursive calls
const globalState = new MonitorState();

// The default dependencies use the actual production functions.
const defaultDependencies = {
  getChainIdentity: cosmos.getChainIdentity,
  getBlockHeight: cosmos.getBlockHeight,
  getUpgradePlan: cosmos.getUpgradePlanBlockHeight,
  triggerUpdatePipeline: gitlab.triggerGitlabUpdatePipeline,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  delay: createSignalAwareDelay,
};

/**
 * Logs chain identity details.
 *
 * @param identity - The chain identity object containing node details.
 */
function logChainIdentity(identity: ChainIdentity): void {
  logger.info(`Node ID: ${identity.nodeId}`);
  logger.info(`Listen Address: ${identity.listenAddr}`);
  logger.info(`Network: ${identity.network}`);
  logger.info(`Moniker: ${identity.moniker}`);
  logger.info(`Version: ${identity.version}`);
  logger.info(`RPC Address: ${identity.rpcAddress}`);
}

/**
 * Ensures chain identity is available, fetching it if necessary.
 * Logs identity details on first successful fetch.
 *
 * @param config - The application configuration.
 * @param state - The monitor state object.
 * @param deps - Dependencies for external calls.
 * @returns The chain identity or null if node is unreachable.
 */
export async function ensureChainIdentity(
  config: Config,
  state: MonitorState,
  deps: typeof defaultDependencies,
): Promise<ChainIdentity | null> {
  if (state.chainIdentity !== null) {
    return state.chainIdentity;
  }

  state.chainIdentity = await deps.getChainIdentity(config.cosmosNodeRestUrl);
  if (state.chainIdentity === null) {
    logger.warn(
      `Node ${config.cosmosNodeRestUrl} is not reachable or not ready to accept requests`,
    );
    return null;
  }

  logChainIdentity(state.chainIdentity);
  return state.chainIdentity;
}

/**
 * Checks node liveness by fetching current block height.
 * Manages liveness state transitions and logging.
 *
 * @param config - The application configuration.
 * @param state - The monitor state object.
 * @param deps - Dependencies for external calls.
 * @returns Object with current height and whether to wait for next cycle.
 */
export async function checkNodeLiveness(
  config: Config,
  state: MonitorState,
  deps: typeof defaultDependencies,
): Promise<{ currentHeight: number | null; shouldWait: boolean }> {
  const currentHeight = await deps.getBlockHeight(config.cosmosNodeRestUrl);

  if (!currentHeight) {
    if (!state.isCosmosNodeDown) {
      state.isCosmosNodeDown = true;
    }
    logger.warn(
      `Waiting for node with identity ${state.chainIdentity!.moniker}`,
    );
    return { currentHeight: null, shouldWait: true };
  }

  if (state.isCosmosNodeDown) {
    logger.info(
      `Node with identity ${state.chainIdentity!.moniker} is back online`,
    );
    logChainIdentity(state.chainIdentity!);
    state.isCosmosNodeDown = false;
  }

  return { currentHeight, shouldWait: false };
}

/**
 * Detects and caches upgrade plan information.
 * Logs upgrade detection when plan is first discovered.
 *
 * @param config - The application configuration.
 * @param state - The monitor state object.
 * @param deps - Dependencies for external calls.
 */
export async function detectUpgradePlan(
  config: Config,
  state: MonitorState,
  deps: typeof defaultDependencies,
): Promise<void> {
  if (state.upgradePlanBlockHeight !== null) {
    return;
  }

  state.upgradePlanBlockHeight = await deps.getUpgradePlan(
    config.cosmosNodeRestUrl,
  );

  if (state.upgradePlanBlockHeight !== null) {
    logger.info(
      `Upgrade plan detected for ${state.chainIdentity!.moniker} (${
        state.chainIdentity!.network
      }): Height ${state.upgradePlanBlockHeight}`,
    );
  }
}

/**
 * Handles upgrade execution when current height reaches upgrade height.
 * Manages post-upgrade cleanup and waiting periods.
 *
 * @param config - The application configuration.
 * @param state - The monitor state object.
 * @param deps - Dependencies for external calls.
 * @param currentHeight - The current blockchain height.
 * @param signal - Optional AbortSignal for graceful shutdown.
 * @returns Object indicating if upgrade was executed and whether to continue monitoring.
 */
export async function handleUpgradeExecution(
  config: Config,
  state: MonitorState,
  deps: typeof defaultDependencies,
  currentHeight: number,
  signal?: AbortSignal,
): Promise<{ executed: boolean; shouldContinue: boolean }> {
  if (
    !state.upgradePlanBlockHeight ||
    currentHeight < state.upgradePlanBlockHeight
  ) {
    return { executed: false, shouldContinue: true };
  }

  const pipelineFinishedSuccessful = await deps.triggerUpdatePipeline(config);

  if (pipelineFinishedSuccessful) {
    logger.info(
      `Pipeline finished successfully. Pause monitoring for ${
        POST_UPGRADE_WAIT_MS / 60000
      } minutes.`,
    );
    state.upgradePlanBlockHeight = null;
    await deps.delay(POST_UPGRADE_WAIT_MS, signal);
    logger.info(
      `Upgrade completed for ${state.chainIdentity!.moniker} (${
        state.chainIdentity!.network
      }). Monitoring resumed.`,
    );
    state.chainIdentity = await deps.getChainIdentity(
      config.cosmosNodeRestUrl,
    );
    return { executed: true, shouldContinue: true };
  } else {
    logger.critical(
      `Failed to trigger pipeline! Upgrade will be re-attempted next cycle.`,
    );
    await deps.delay(POST_UPGRADE_WAIT_MS, signal);
    return { executed: true, shouldContinue: true };
  }
}

/**
 * Executes a single monitoring cycle with proper cleanup.
 *
 * @param config - The application configuration.
 * @param deps - Dependencies for external calls.
 * @param cleanup - Cleanup function to call when done.
 * @param resolve - Promise resolve function to call when complete.
 * @param signal - Optional AbortSignal for graceful shutdown.
 */
async function executeMonitoringCycle(
  config: Config,
  deps: typeof defaultDependencies,
  cleanup: () => void,
  resolve: () => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    if (!signal?.aborted) {
      await monitorChain(config, deps, signal);
    }
  } finally {
    cleanup();
    resolve();
  }
}

/**
 * Creates a scheduler function for recursive monitoring calls.
 * Handles abort signal cleanup and resource management.
 *
 * @param config - The application configuration.
 * @param deps - Dependencies for external calls.
 * @param signal - Optional AbortSignal for graceful shutdown.
 * @returns Function to schedule next monitoring cycle.
 */
export function createMonitorScheduler(
  config: Config,
  deps: typeof defaultDependencies,
  signal?: AbortSignal,
): (delay: number) => Promise<void> {
  return function scheduleNextMonitor(delay: number): Promise<void> {
    if (signal?.aborted) return Promise.resolve();

    return new Promise((resolve) => {
      let timeoutId: number | null = null;
      let abortListener: (() => void) | null = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        if (abortListener && signal) {
          signal.removeEventListener("abort", abortListener);
        }
      };

      const executeNextMonitor = () =>
        executeMonitoringCycle(config, deps, cleanup, resolve, signal);

      timeoutId = deps.setTimeout(executeNextMonitor, delay);

      if (signal) {
        abortListener = () => {
          cleanup();
          resolve();
        };
        signal.addEventListener("abort", abortListener);
      }
    });
  };
}

/**
 * Monitors the blockchain for block height and upgrade plans.
 * Dependencies are injected to allow for mocking in tests.
 *
 * @param config - The application configuration.
 * @param deps - Dependencies object containing external functions.
 * @param signal - Optional AbortSignal for graceful shutdown.
 */
export async function monitorChain(
  config: Config,
  deps = defaultDependencies,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;

  const state = globalState;
  const scheduleNextMonitor = createMonitorScheduler(config, deps, signal);

  try {
    const chainIdentity = await ensureChainIdentity(config, state, deps);
    if (chainIdentity === null) {
      await scheduleNextMonitor(LONG_POLL_INTERVAL_MS);
      return;
    }

    const { currentHeight, shouldWait } = await checkNodeLiveness(
      config,
      state,
      deps,
    );
    if (shouldWait) {
      await scheduleNextMonitor(LONG_POLL_INTERVAL_MS);
      return;
    }

    await detectUpgradePlan(config, state, deps);

    if (!state.upgradePlanBlockHeight) {
      await scheduleNextMonitor(config.pollIntervalMs);
      return;
    }

    const { executed } = await handleUpgradeExecution(
      config,
      state,
      deps,
      currentHeight!,
      signal,
    );
    if (executed) {
      await scheduleNextMonitor(config.pollIntervalMs);
      return;
    }

    await scheduleNextMonitor(config.pollIntervalMs);
  } catch (err) {
    logger.error(`Monitor loop error: ${err}`);
    await scheduleNextMonitor(ERROR_RETRY_INTERVAL_MS);
  }
}
