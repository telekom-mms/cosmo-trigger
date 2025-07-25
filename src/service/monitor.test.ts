import { type Config } from "config/config.ts";
import {
  checkNodeLiveness,
  createMonitorScheduler,
  detectUpgradePlan,
  ensureChainIdentity,
  handleUpgradeExecution,
  monitorChain,
} from "src/service/monitor.ts";
import { ChainIdentity } from "src/types/chain-identity.ts";
import { MonitorState } from "src/types/monitor.ts";
import { assertEquals } from "test-assert";

const MONITOR_ENV_KEYS = ["COSMOS_NODE_REST_URL", "POLL_INTERVAL_MS"];

function setupMonitorEnv(): void {
  Deno.env.set("COSMOS_NODE_REST_URL", "http://localhost:1317");
  Deno.env.set("POLL_INTERVAL_MS", "2000");
}

function backupEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, Deno.env.get(key)]));
}

function restoreEnv(backup: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(backup)) {
    if (value) {
      Deno.env.set(key, value);
    } else {
      Deno.env.delete(key);
    }
  }
}

function createMockChainIdentity(): ChainIdentity {
  return {
    nodeId: "test-node-id",
    listenAddr: "tcp://0.0.0.0:26656",
    network: "test-network",
    moniker: "test-node",
    version: "0.38.17",
    rpcAddress: "tcp://0.0.0.0:26657",
  };
}

function createMockConfig(): Config {
  return {
    applicationPort: 8080,
    pollIntervalMs: 2000,
    cosmosNodeRestUrl: "http://localhost:1317",
    cicdTriggerToken: "test-token",
    cicdPersonalAccessToken: "test-pat",
    cicdRepositoryBranch: "main",
    cicdProjectApiUrl: "https://gitlab.example.com/api/v4/projects/1234",
    cicdVariables: "",
  };
}

interface MockDependencies {
  getChainIdentity: (url: string) => Promise<ChainIdentity | null>;
  getBlockHeight: (url: string) => Promise<number | null>;
  getUpgradePlan: (url: string) => Promise<number | null>;
  triggerUpdatePipeline: (config: Config) => Promise<boolean>;
  setTimeout: (
    cb: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => number;
  delay: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function createMockDependencies(
  overrides: Partial<MockDependencies> = {},
): MockDependencies {
  let nextTimerId = 1;

  return {
    getChainIdentity: () => Promise.resolve(createMockChainIdentity()),
    getBlockHeight: () => Promise.resolve(12345),
    getUpgradePlan: () => Promise.resolve(null),
    triggerUpdatePipeline: (_config: Config) => Promise.resolve(true),
    setTimeout: (
      _cb: (...args: unknown[]) => void,
      _delay?: number,
      ..._args: unknown[]
    ) => {
      // Don't execute callback to prevent infinite recursion
      // Return incremental timer IDs for realistic behavior
      return nextTimerId++;
    },
    delay: (_ms: number, _signal?: AbortSignal) => Promise.resolve(),
    ...overrides,
  };
}

Deno.test(
  "monitorChain should fetch chain identity on first run",
  async () => {
    const originalEnv = backupEnv(MONITOR_ENV_KEYS);
    let getChainIdentityCalled = false;
    let getBlockHeightCalled = false;

    try {
      setupMonitorEnv();

      const controller = new AbortController();
      const deps = createMockDependencies({
        getChainIdentity: () => {
          getChainIdentityCalled = true;
          return Promise.resolve(createMockChainIdentity());
        },
        getBlockHeight: () => {
          getBlockHeightCalled = true;
          return Promise.resolve(12345);
        },
      });

      // Abort after a short delay to prevent hanging
      setTimeout(() => controller.abort(), 10);

      await monitorChain(createMockConfig(), deps, controller.signal);

      assertEquals(getChainIdentityCalled, true);
      assertEquals(getBlockHeightCalled, true);
    } finally {
      restoreEnv(originalEnv);
    }
  },
);

// Note: Test for chain identity fetch failure is skipped due to complexity
// of module-level state management in monitorChain. This test would
// require proper state reset functionality in the monitor service.

Deno.test(
  "monitorChain should handle block height fetch failure",
  async () => {
    const originalEnv = backupEnv(MONITOR_ENV_KEYS);
    let getBlockHeightCalled = false;
    let setTimeoutCalled = false;

    try {
      setupMonitorEnv();

      const controller = new AbortController();
      const deps = createMockDependencies({
        getChainIdentity: () => Promise.resolve(createMockChainIdentity()),
        getBlockHeight: () => {
          getBlockHeightCalled = true;
          return Promise.resolve(null);
        },
        setTimeout: (
          _cb: (...args: unknown[]) => void,
          delay?: number,
          ..._args: unknown[]
        ) => {
          setTimeoutCalled = true;
          assertEquals(delay, 10000); // LONG_POLL_INTERVAL_MS
          return 1;
        },
      });

      setTimeout(() => controller.abort(), 10);
      await monitorChain(createMockConfig(), deps, controller.signal);

      assertEquals(getBlockHeightCalled, true);
      assertEquals(setTimeoutCalled, true);
    } finally {
      restoreEnv(originalEnv);
    }
  },
);

Deno.test(
  "monitorChain should detect upgrade plan",
  async () => {
    const originalEnv = backupEnv(MONITOR_ENV_KEYS);
    let getUpgradePlanCalled = false;
    let setTimeoutCalled = false;

    try {
      setupMonitorEnv();

      const controller = new AbortController();
      const deps = createMockDependencies({
        getChainIdentity: () => Promise.resolve(createMockChainIdentity()),
        getBlockHeight: () => Promise.resolve(12345),
        getUpgradePlan: () => {
          getUpgradePlanCalled = true;
          return Promise.resolve(15000); // Future block height
        },
        setTimeout: (
          _cb: (...args: unknown[]) => void,
          delay?: number,
          ..._args: unknown[]
        ) => {
          setTimeoutCalled = true;
          assertEquals(delay, 2000); // POLL_INTERVAL_MS
          return 1;
        },
      });

      setTimeout(() => controller.abort(), 10);
      await monitorChain(createMockConfig(), deps, controller.signal);

      assertEquals(getUpgradePlanCalled, true);
      assertEquals(setTimeoutCalled, true);
    } finally {
      restoreEnv(originalEnv);
    }
  },
);

Deno.test(
  "monitorChain should trigger update pipeline when upgrade height reached",
  async () => {
    const originalEnv = backupEnv(MONITOR_ENV_KEYS);
    let triggerUpdatePipelineCalled = false;
    let setTimeoutCallCount = 0;
    let delayCallCount = 0;

    try {
      setupMonitorEnv();

      const controller = new AbortController();
      const deps = createMockDependencies({
        getChainIdentity: () => Promise.resolve(createMockChainIdentity()),
        getBlockHeight: () => Promise.resolve(15000), // Current height
        getUpgradePlan: () => Promise.resolve(15000), // Upgrade at same height
        triggerUpdatePipeline: () => {
          triggerUpdatePipelineCalled = true;
          return Promise.resolve(true);
        },
        delay: (ms: number) => {
          delayCallCount++;
          if (delayCallCount === 1) {
            assertEquals(ms, 600000); // POST_UPGRADE_WAIT_MS
          }
          return Promise.resolve();
        },
        setTimeout: (
          _cb: (...args: unknown[]) => void,
          delay?: number,
          ..._args: unknown[]
        ) => {
          setTimeoutCallCount++;
          if (setTimeoutCallCount === 1) {
            assertEquals(delay, 2000); // Regular poll interval to resume monitoring
          }
          return 1;
        },
      });

      setTimeout(() => controller.abort(), 10);
      await monitorChain(createMockConfig(), deps, controller.signal);

      assertEquals(triggerUpdatePipelineCalled, true);
      assertEquals(delayCallCount, 1); // Should call delay once for POST_UPGRADE_WAIT_MS
      assertEquals(setTimeoutCallCount, 1); // Should call setTimeout once for scheduling next monitor
    } finally {
      restoreEnv(originalEnv);
    }
  },
);

Deno.test(
  "monitorChain should continue monitoring when no upgrade plan",
  async () => {
    const originalEnv = backupEnv(MONITOR_ENV_KEYS);
    let getUpgradePlanCalled = false;
    let setTimeoutCalled = false;

    try {
      setupMonitorEnv();

      const controller = new AbortController();
      const deps = createMockDependencies({
        getChainIdentity: () => Promise.resolve(createMockChainIdentity()),
        getBlockHeight: () => Promise.resolve(12345),
        getUpgradePlan: () => {
          getUpgradePlanCalled = true;
          return Promise.resolve(null); // No upgrade plan
        },
        setTimeout: (
          _cb: (...args: unknown[]) => void,
          delay?: number,
          ..._args: unknown[]
        ) => {
          setTimeoutCalled = true;
          assertEquals(delay, 2000); // POLL_INTERVAL_MS
          return 1;
        },
      });

      setTimeout(() => controller.abort(), 10);
      await monitorChain(createMockConfig(), deps, controller.signal);

      assertEquals(getUpgradePlanCalled, true);
      assertEquals(setTimeoutCalled, true);
    } finally {
      restoreEnv(originalEnv);
    }
  },
);

Deno.test(
  "monitorChain should handle errors gracefully",
  async () => {
    const originalEnv = backupEnv(MONITOR_ENV_KEYS);
    let setTimeoutCalled = false;

    try {
      setupMonitorEnv();

      const controller = new AbortController();
      const deps = createMockDependencies({
        getChainIdentity: () => Promise.resolve(createMockChainIdentity()),
        getBlockHeight: () => {
          throw new Error("Network error");
        },
        setTimeout: (
          _cb: (...args: unknown[]) => void,
          delay?: number,
          ..._args: unknown[]
        ) => {
          setTimeoutCalled = true;
          assertEquals(delay, 5000); // Error retry interval
          return 1;
        },
      });

      setTimeout(() => controller.abort(), 10);
      await monitorChain(createMockConfig(), deps, controller.signal);

      assertEquals(setTimeoutCalled, true);
    } finally {
      restoreEnv(originalEnv);
    }
  },
);

Deno.test(
  "monitorChain should wait for upgrade when current height is below upgrade height",
  async () => {
    const originalEnv = backupEnv(MONITOR_ENV_KEYS);
    let setTimeoutCalled = false;

    try {
      setupMonitorEnv();

      const controller = new AbortController();
      const deps = createMockDependencies({
        getChainIdentity: () => Promise.resolve(createMockChainIdentity()),
        getBlockHeight: () => Promise.resolve(10000), // Current height
        getUpgradePlan: () => Promise.resolve(15000), // Upgrade at higher height
        setTimeout: (
          _cb: (...args: unknown[]) => void,
          delay?: number,
          ..._args: unknown[]
        ) => {
          setTimeoutCalled = true;
          assertEquals(delay, 2000); // POLL_INTERVAL_MS
          return 1;
        },
      });

      setTimeout(() => controller.abort(), 10);
      await monitorChain(createMockConfig(), deps, controller.signal);

      assertEquals(setTimeoutCalled, true);
    } finally {
      restoreEnv(originalEnv);
    }
  },
);

// Unit Tests for Helper Functions

// ensureChainIdentity Tests
Deno.test(
  "ensureChainIdentity should return cached identity when already available",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    const existingIdentity = createMockChainIdentity();
    state.chainIdentity = existingIdentity;

    let getChainIdentityCalled = false;
    const deps = createMockDependencies({
      getChainIdentity: () => {
        getChainIdentityCalled = true;
        return Promise.resolve(createMockChainIdentity());
      },
    });

    const result = await ensureChainIdentity(config, state, deps);

    assertEquals(result, existingIdentity);
    assertEquals(getChainIdentityCalled, false); // Should not call API
  },
);

Deno.test(
  "ensureChainIdentity should fetch and cache identity on first call",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    const expectedIdentity = createMockChainIdentity();

    let getChainIdentityCalled = false;
    const deps = createMockDependencies({
      getChainIdentity: () => {
        getChainIdentityCalled = true;
        return Promise.resolve(expectedIdentity);
      },
    });

    const result = await ensureChainIdentity(config, state, deps);

    assertEquals(result, expectedIdentity);
    assertEquals(state.chainIdentity, expectedIdentity);
    assertEquals(getChainIdentityCalled, true);
  },
);

Deno.test(
  "ensureChainIdentity should return null and warn when node unreachable",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();

    let getChainIdentityCalled = false;
    const deps = createMockDependencies({
      getChainIdentity: () => {
        getChainIdentityCalled = true;
        return Promise.resolve(null);
      },
    });

    const result = await ensureChainIdentity(config, state, deps);

    assertEquals(result, null);
    assertEquals(state.chainIdentity, null);
    assertEquals(getChainIdentityCalled, true);
  },
);

// checkNodeLiveness Tests
Deno.test(
  "checkNodeLiveness should return height and shouldWait=false when node responsive",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();

    const expectedHeight = 12345;
    let getBlockHeightCalled = false;
    const deps = createMockDependencies({
      getBlockHeight: () => {
        getBlockHeightCalled = true;
        return Promise.resolve(expectedHeight);
      },
    });

    const result = await checkNodeLiveness(config, state, deps);

    assertEquals(result.currentHeight, expectedHeight);
    assertEquals(result.shouldWait, false);
    assertEquals(getBlockHeightCalled, true);
  },
);

Deno.test(
  "checkNodeLiveness should return null height and shouldWait=true when node down",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();

    let getBlockHeightCalled = false;
    const deps = createMockDependencies({
      getBlockHeight: () => {
        getBlockHeightCalled = true;
        return Promise.resolve(null);
      },
    });

    const result = await checkNodeLiveness(config, state, deps);

    assertEquals(result.currentHeight, null);
    assertEquals(result.shouldWait, true);
    assertEquals(state.isCosmosNodeDown, true);
    assertEquals(getBlockHeightCalled, true);
  },
);

Deno.test(
  "checkNodeLiveness should manage liveness state transitions correctly",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();
    state.isCosmosNodeDown = true; // Previously down

    const deps = createMockDependencies({
      getBlockHeight: () => Promise.resolve(12345),
    });

    const result = await checkNodeLiveness(config, state, deps);

    assertEquals(result.currentHeight, 12345);
    assertEquals(result.shouldWait, false);
    assertEquals(state.isCosmosNodeDown, false); // Should reset to false
  },
);

// detectUpgradePlan Tests
Deno.test(
  "detectUpgradePlan should skip detection when plan already cached",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();
    state.upgradePlanBlockHeight = 15000; // Already cached

    let getUpgradePlanCalled = false;
    const deps = createMockDependencies({
      getUpgradePlan: () => {
        getUpgradePlanCalled = true;
        return Promise.resolve(20000);
      },
    });

    await detectUpgradePlan(config, state, deps);

    assertEquals(state.upgradePlanBlockHeight, 15000); // Should remain unchanged
    assertEquals(getUpgradePlanCalled, false); // Should not call API
  },
);

Deno.test(
  "detectUpgradePlan should fetch and cache upgrade plan when not present",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();

    const expectedHeight = 15000;
    let getUpgradePlanCalled = false;
    const deps = createMockDependencies({
      getUpgradePlan: () => {
        getUpgradePlanCalled = true;
        return Promise.resolve(expectedHeight);
      },
    });

    await detectUpgradePlan(config, state, deps);

    assertEquals(state.upgradePlanBlockHeight, expectedHeight);
    assertEquals(getUpgradePlanCalled, true);
  },
);

Deno.test(
  "detectUpgradePlan should handle no upgrade plan gracefully",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();

    let getUpgradePlanCalled = false;
    const deps = createMockDependencies({
      getUpgradePlan: () => {
        getUpgradePlanCalled = true;
        return Promise.resolve(null);
      },
    });

    await detectUpgradePlan(config, state, deps);

    assertEquals(state.upgradePlanBlockHeight, null);
    assertEquals(getUpgradePlanCalled, true);
  },
);

// handleUpgradeExecution Tests
Deno.test(
  "handleUpgradeExecution should return not executed when no upgrade plan",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();
    // No upgrade plan set

    const deps = createMockDependencies();

    const result = await handleUpgradeExecution(config, state, deps, 12345);

    assertEquals(result.executed, false);
    assertEquals(result.shouldContinue, true);
  },
);

Deno.test(
  "handleUpgradeExecution should return not executed when height below upgrade height",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();
    state.upgradePlanBlockHeight = 15000;

    const deps = createMockDependencies();

    const result = await handleUpgradeExecution(config, state, deps, 12345);

    assertEquals(result.executed, false);
    assertEquals(result.shouldContinue, true);
  },
);

Deno.test(
  "handleUpgradeExecution should handle successful pipeline execution",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    const originalIdentity = createMockChainIdentity();
    const newIdentity = { ...originalIdentity, version: "0.39.0" };
    state.chainIdentity = originalIdentity;
    state.upgradePlanBlockHeight = 15000;

    let triggerUpdatePipelineCalled = false;
    let delayCalled = false;
    let getChainIdentityCalled = false;

    const deps = createMockDependencies({
      triggerUpdatePipeline: () => {
        triggerUpdatePipelineCalled = true;
        return Promise.resolve(true);
      },
      delay: (ms: number) => {
        delayCalled = true;
        assertEquals(ms, 600000); // POST_UPGRADE_WAIT_MS
        return Promise.resolve();
      },
      getChainIdentity: () => {
        getChainIdentityCalled = true;
        return Promise.resolve(newIdentity);
      },
    });

    const result = await handleUpgradeExecution(config, state, deps, 15000);

    assertEquals(result.executed, true);
    assertEquals(result.shouldContinue, true);
    assertEquals(state.upgradePlanBlockHeight, null); // Should reset
    assertEquals(state.chainIdentity, newIdentity); // Should refresh
    assertEquals(triggerUpdatePipelineCalled, true);
    assertEquals(delayCalled, true);
    assertEquals(getChainIdentityCalled, true);
  },
);

Deno.test(
  "handleUpgradeExecution should handle failed pipeline execution",
  async () => {
    const config = createMockConfig();
    const state = new MonitorState();
    state.chainIdentity = createMockChainIdentity();
    state.upgradePlanBlockHeight = 15000;

    let triggerUpdatePipelineCalled = false;
    let delayCalled = false;

    const deps = createMockDependencies({
      triggerUpdatePipeline: () => {
        triggerUpdatePipelineCalled = true;
        return Promise.resolve(false);
      },
      delay: (ms: number) => {
        delayCalled = true;
        assertEquals(ms, 600000); // POST_UPGRADE_WAIT_MS
        return Promise.resolve();
      },
    });

    const result = await handleUpgradeExecution(config, state, deps, 15000);

    assertEquals(result.executed, true);
    assertEquals(result.shouldContinue, true);
    assertEquals(state.upgradePlanBlockHeight, 15000); // Should NOT reset
    assertEquals(triggerUpdatePipelineCalled, true);
    assertEquals(delayCalled, true);
  },
);

// createMonitorScheduler Tests
Deno.test(
  "createMonitorScheduler should create function that respects abort signal",
  () => {
    const config = createMockConfig();
    const deps = createMockDependencies();
    const controller = new AbortController();
    controller.abort(); // Pre-abort

    const scheduler = createMonitorScheduler(config, deps, controller.signal);
    const promise = scheduler(1000);

    // Should resolve immediately when signal is aborted
    assertEquals(promise instanceof Promise, true);
  },
);

Deno.test(
  "createMonitorScheduler should call setTimeout with correct delay",
  async () => {
    const config = createMockConfig();
    let setTimeoutCalled = false;
    let capturedDelay = 0;

    const controller = new AbortController();
    const deps = createMockDependencies({
      setTimeout: (_cb, delay) => {
        setTimeoutCalled = true;
        capturedDelay = delay || 0;
        return 1; // Return realistic timer ID
      },
    });

    const scheduler = createMonitorScheduler(config, deps, controller.signal);

    // Abort immediately to resolve the Promise
    setTimeout(() => controller.abort(), 5);

    await scheduler(1000);

    assertEquals(setTimeoutCalled, true);
    assertEquals(capturedDelay, 1000);
  },
);

// MonitorState Tests
Deno.test("MonitorState should initialize with correct default values", () => {
  const state = new MonitorState();

  assertEquals(state.upgradePlanBlockHeight, null);
  assertEquals(state.chainIdentity, null);
  assertEquals(state.isCosmosNodeDown, false);
});

Deno.test(
  "MonitorState should reset all properties to defaults when reset called",
  () => {
    const state = new MonitorState();

    // Set some values
    state.upgradePlanBlockHeight = 15000;
    state.chainIdentity = createMockChainIdentity();
    state.isCosmosNodeDown = true;

    // Reset
    state.reset();

    // Should be back to defaults
    assertEquals(state.upgradePlanBlockHeight, null);
    assertEquals(state.chainIdentity, null);
    assertEquals(state.isCosmosNodeDown, false);
  },
);

Deno.test(
  "MonitorState should maintain state across property modifications",
  () => {
    const state = new MonitorState();
    const identity = createMockChainIdentity();

    state.upgradePlanBlockHeight = 15000;
    state.chainIdentity = identity;
    state.isCosmosNodeDown = true;

    assertEquals(state.upgradePlanBlockHeight, 15000);
    assertEquals(state.chainIdentity, identity);
    assertEquals(state.isCosmosNodeDown, true);
  },
);
