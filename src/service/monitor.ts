import { type Config } from "config/config.ts";
import * as cosmos from "src/service/cosmos.ts";
import * as gitlab from "src/service/gitlab.ts";
import { ChainIdentity } from "src/types/chain-identity.ts";
import { logger } from "src/utils/logger.ts";

const LONG_POLL_INTERVAL_MS = 10_000;
const POST_UPGRADE_WAIT_MS = 600_000;
const ERROR_RETRY_INTERVAL_MS = 5_000;

/**
 * Class-based Cosmos blockchain monitor that encapsulates all monitoring state and behavior.
 */
export class CosmosMonitor {
  private upgradePlanBlockHeight: number | null = null;
  private chainIdentity: ChainIdentity | null = null;
  private isCosmosNodeDown: boolean = false;

  constructor(
    private readonly config: Config,
  ) {}

  /**
   * Resets all internal state to initial values for memory cleanup.
   */
  reset(): void {
    this.upgradePlanBlockHeight = null;
    this.chainIdentity = null;
    this.isCosmosNodeDown = false;
  }

  /**
   * Starts the monitoring loop that continuously monitors the blockchain until aborted.
   *
   * @param signal - Optional AbortSignal for graceful shutdown
   */
  async startMonitoring(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      try {
        const delay = await this.monitorChain(signal);
        if (delay !== null) {
          await this.createSignalAwareDelay(delay, signal);
        }
      } catch (err) {
        logger.error(`Monitor loop error: ${err}`);
        await this.createSignalAwareDelay(ERROR_RETRY_INTERVAL_MS, signal);
      }
    }
  }

  /**
   * Creates a signal-aware delay that can be interrupted by AbortSignal.
   *
   * @param ms - Delay duration in milliseconds
   * @param signal - Optional AbortSignal for early termination
   * @returns Promise that resolves after delay or immediately if aborted
   */
  private createSignalAwareDelay(
    ms: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const abortHandler = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abortHandler);
      };

      signal?.addEventListener("abort", abortHandler);
    });
  }

  /**
   * Logs chain identity details.
   *
   * @param identity - The chain identity object containing node details.
   */
  private logChainIdentity(identity: ChainIdentity): void {
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
   * @returns The chain identity or null if node is unreachable.
   */
  private async ensureChainIdentity(): Promise<ChainIdentity | null> {
    if (this.chainIdentity !== null) {
      return this.chainIdentity;
    }

    this.chainIdentity = await cosmos.getChainIdentity(
      this.config.cosmosNodeRestUrl,
    );
    if (this.chainIdentity === null) {
      logger.warn(
        `Node ${this.config.cosmosNodeRestUrl} is not reachable or not ready to accept requests`,
      );
      return null;
    }

    this.logChainIdentity(this.chainIdentity);
    return this.chainIdentity;
  }

  /**
   * Checks node liveness by fetching current block height.
   * Manages liveness state transitions and logging.
   *
   * @returns Object with current height and whether to wait for next cycle.
   */
  private async checkNodeLiveness(): Promise<
    { currentHeight: number | null; shouldWait: boolean }
  > {
    const currentHeight = await cosmos.getBlockHeight(
      this.config.cosmosNodeRestUrl,
    );

    if (!currentHeight) {
      if (!this.isCosmosNodeDown) {
        this.isCosmosNodeDown = true;
      }
      logger.warn(
        `Waiting for node with identity ${this.chainIdentity!.moniker}`,
      );
      return { currentHeight: null, shouldWait: true };
    }

    if (this.isCosmosNodeDown) {
      logger.info(
        `Node with identity ${this.chainIdentity!.moniker} is back online`,
      );
      this.logChainIdentity(this.chainIdentity!);
      this.isCosmosNodeDown = false;
    }

    return { currentHeight, shouldWait: false };
  }

  /**
   * Detects and caches upgrade plan information.
   * Logs upgrade detection when plan is first discovered.
   */
  private async detectUpgradePlan(): Promise<void> {
    if (this.upgradePlanBlockHeight !== null) {
      return;
    }

    this.upgradePlanBlockHeight = await cosmos.getUpgradePlanBlockHeight(
      this.config.cosmosNodeRestUrl,
    );

    if (this.upgradePlanBlockHeight !== null) {
      logger.info(
        `Upgrade plan detected for ${this.chainIdentity!.moniker} (${
          this.chainIdentity!.network
        }): Height ${this.upgradePlanBlockHeight}`,
      );
    }
  }

  /**
   * Handles upgrade execution when current height reaches upgrade height.
   * Manages post-upgrade cleanup and waiting periods.
   *
   * @param currentHeight - The current blockchain height.
   * @param signal - Optional AbortSignal for graceful shutdown.
   * @returns Object indicating if upgrade was executed and whether to continue monitoring.
   */
  private async handleUpgradeExecution(
    currentHeight: number,
    signal?: AbortSignal,
  ): Promise<{ executed: boolean; shouldContinue: boolean }> {
    if (
      !this.upgradePlanBlockHeight ||
      currentHeight < this.upgradePlanBlockHeight
    ) {
      return { executed: false, shouldContinue: true };
    }

    const pipelineFinishedSuccessful = await gitlab.triggerGitlabUpdatePipeline(
      this.config,
    );

    if (pipelineFinishedSuccessful) {
      logger.info(
        `Pipeline finished successfully. Pause monitoring for ${
          POST_UPGRADE_WAIT_MS / 60000
        } minutes.`,
      );
      this.upgradePlanBlockHeight = null;
      await this.createSignalAwareDelay(POST_UPGRADE_WAIT_MS, signal);
      logger.info(
        `Upgrade completed for ${this.chainIdentity!.moniker} (${
          this.chainIdentity!.network
        }). Monitoring resumed.`,
      );
      this.chainIdentity = await cosmos.getChainIdentity(
        this.config.cosmosNodeRestUrl,
      );
      return { executed: true, shouldContinue: true };
    } else {
      logger.critical(
        `Failed to trigger pipeline! Upgrade will be re-attempted next cycle.`,
      );
      await this.createSignalAwareDelay(POST_UPGRADE_WAIT_MS, signal);
      return { executed: true, shouldContinue: true };
    }
  }

  /**
   * Executes a single monitoring cycle and returns the delay for the next cycle.
   *
   * @param signal - Optional AbortSignal for graceful shutdown.
   * @returns The delay in milliseconds for the next monitoring cycle, or null if aborted.
   */
  private async monitorChain(signal?: AbortSignal): Promise<number | null> {
    if (signal?.aborted) return null;

    const chainIdentity = await this.ensureChainIdentity();
    if (chainIdentity === null) {
      return LONG_POLL_INTERVAL_MS;
    }

    const { currentHeight, shouldWait } = await this.checkNodeLiveness();
    if (shouldWait) {
      return LONG_POLL_INTERVAL_MS;
    }

    await this.detectUpgradePlan();

    if (!this.upgradePlanBlockHeight) {
      return this.config.pollIntervalMs;
    }

    const { executed } = await this.handleUpgradeExecution(
      currentHeight!,
      signal,
    );
    if (executed) {
      return this.config.pollIntervalMs;
    }

    return this.config.pollIntervalMs;
  }
}
