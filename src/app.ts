import { type Config, loadConfig } from "config/config.ts";
import { startHealthServer } from "src/service/health.ts";
import { CosmosMonitor } from "src/service/monitor.ts";
import { ConfigurationError } from "src/types/result.ts";
import { logger } from "src/utils/logger.ts";

/**
 * Function to monitor the blockchain and handle errors.
 */
async function monitorBlockchain(
  config: Config,
  signal: AbortSignal,
): Promise<void> {
  const monitor = new CosmosMonitor(config);
  try {
    await monitor.startMonitoring(signal);
  } catch (err) {
    logger.error("Error in monitoring the chain:", err);
    throw err;
  } finally {
    monitor.reset();
  }
}

/**
 * Function to manage the health server lifecycle and handle errors.
 */
async function manageHealthServer(
  config: Config,
  signal: AbortSignal,
): Promise<void> {
  const healthServer = startHealthServer(config.applicationPort);

  try {
    signal.addEventListener("abort", async () => {
      await healthServer.shutdown();
    });

    await healthServer.serverPromise;
  } catch (err) {
    logger.error("Error in starting the health server:", err);
    throw err;
  }
}

/**
 * Main function to run both the health server and blockchain monitor.
 */
async function main(): Promise<void> {
  let config: Config;

  try {
    config = await loadConfig();
    logger.info("Configuration loaded successfully");
  } catch (err) {
    if (err instanceof ConfigurationError) {
      logger.error("Configuration error: Exiting CosmoTrigger!");
      logger.error(err.message);
    } else {
      logger.error("Failed to load configuration:", err);
    }
    Deno.exit(1);
  }

  const abortController = new AbortController();
  const { signal } = abortController;

  const signals = Deno.build.os === "windows"
    ? ["SIGINT", "SIGBREAK"] as const
    : ["SIGINT", "SIGTERM"] as const;

  let shutdownInitiated = false;
  for (const sig of signals) {
    Deno.addSignalListener(sig, () => {
      if (!shutdownInitiated) {
        shutdownInitiated = true;
        logger.info(`Received ${sig}, initiating graceful shutdown...`);
        abortController.abort();
      }
    });
  }

  try {
    const healthPromise = manageHealthServer(config, signal);
    const monitorPromise = monitorBlockchain(config, signal);

    await Promise.race([
      healthPromise.catch((err) => {
        logger.error("Health server failed:", err);
        abortController.abort();
        throw err;
      }),
      monitorPromise.catch((err) => {
        logger.error("Blockchain monitor failed:", err);
        abortController.abort();
        throw err;
      }),
    ]);
  } catch (err) {
    if (!signal.aborted) {
      logger.error("Application error:", err);
      abortController.abort();
    }
  } finally {
    logger.info("Application shutdown complete");
  }
}

await main();
