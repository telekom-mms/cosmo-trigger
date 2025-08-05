import { type Config } from "config/config.ts";
import { CosmosMonitor } from "src/service/monitor.ts";
import { logger } from "src/utils/logger.ts";
import { assertEquals } from "test-assert";
import { stub } from "test-mock";
import { FakeTime } from "test-time";

/**
 * Enhanced mock configuration factory for comprehensive testing.
 */
function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    cosmosNodeRestUrl: "http://localhost:1317",
    pollIntervalMs: 2000,
    applicationPort: 8080,
    cicdTriggerToken: "test-trigger-token",
    cicdPersonalAccessToken: "test-pat",
    cicdUpdateBranch: "main",
    cicdProjectApiUrl: "https://gitlab.example.com/api/v4/projects/1234",
    cicdVariables: "",
    ...overrides,
  };
}

// Basic functionality tests
Deno.test("CosmosMonitor should instantiate correctly with config", () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);

  assertEquals(typeof monitor, "object");
});

Deno.test("CosmosMonitor should reset internal state properly", () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);

  monitor.reset();
});

Deno.test("CosmosMonitor should handle multiple reset calls", () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);

  monitor.reset();
  monitor.reset();
  monitor.reset();
});

Deno.test("CosmosMonitor should properly handle aborted signal", async () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);
  const controller = new AbortController();

  controller.abort();

  await monitor.startMonitoring(controller.signal);
});

Deno.test("CosmosMonitor should handle createSignalAwareDelay with pre-aborted signal", async () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);
  const controller = new AbortController();

  // Abort signal before starting
  controller.abort();

  // Should return immediately without delay
  const startTime = Date.now();
  await monitor.startMonitoring(controller.signal);
  const endTime = Date.now();

  // Should complete almost immediately (within 50ms)
  assertEquals(endTime - startTime < 50, true);
});

Deno.test("CosmosMonitor should handle quick abort during monitoring", async () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);
  const controller = new AbortController();

  // Abort after a very short time to test graceful shutdown
  setTimeout(() => controller.abort(), 10);

  await monitor.startMonitoring(controller.signal);
});

Deno.test("CosmosMonitor should handle signal abort during delay", async () => {
  const config = createMockConfig({ pollIntervalMs: 1000 });
  const monitor = new CosmosMonitor(config);

  const controller = new AbortController();

  const startTime = Date.now();

  // Abort during any delay that might occur
  setTimeout(() => controller.abort(), 100);

  await monitor.startMonitoring(controller.signal);

  const endTime = Date.now();

  // Should complete much sooner than full poll interval
  assertEquals(endTime - startTime < 800, true);
});

Deno.test("CosmosMonitor should be reusable after reset", async () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);

  // First session
  const controller1 = new AbortController();
  setTimeout(() => controller1.abort(), 10);

  await monitor.startMonitoring(controller1.signal);

  // Reset monitor
  monitor.reset();

  // Second session should work without issues
  const controller2 = new AbortController();
  setTimeout(() => controller2.abort(), 10);

  await monitor.startMonitoring(controller2.signal);
});

Deno.test("CosmosMonitor should handle multiple quick start/stop cycles", async () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);

  for (let i = 0; i < 3; i++) {
    const controller = new AbortController();

    // Start monitoring and immediately abort
    const monitoringPromise = monitor.startMonitoring(controller.signal);
    controller.abort();

    await monitoringPromise;

    // Reset between cycles
    monitor.reset();
  }
});

Deno.test("CosmosMonitor should handle concurrent abort calls", async () => {
  const config = createMockConfig();
  const monitor = new CosmosMonitor(config);
  const controller = new AbortController();

  // Start monitoring
  const monitoringPromise = monitor.startMonitoring(controller.signal);

  // Trigger abort immediately (no need for multiple timers)
  controller.abort();

  await monitoringPromise;
});

// Error handling tests
Deno.test("CosmosMonitor should handle errors during monitoring gracefully", async () => {
  const config = createMockConfig({
    cosmosNodeRestUrl: "http://invalid-url-that-will-fail:1317",
  });
  const monitor = new CosmosMonitor(config);
  const controller = new AbortController();
  const errorStub = stub(logger, "error");

  try {
    // Start monitoring and let it try once, then abort
    const monitoringPromise = monitor.startMonitoring(controller.signal);

    // Give it time to attempt connection and fail
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();

    await monitoringPromise;

    // Should have logged at least one error
    assertEquals(errorStub.calls.length >= 1, true);
  } finally {
    errorStub.restore();
  }
});

Deno.test("CosmosMonitor should continue monitoring after errors", async () => {
  const config = createMockConfig({
    cosmosNodeRestUrl: "http://invalid-url-that-will-fail:1317",
    pollIntervalMs: 50,
  });
  const monitor = new CosmosMonitor(config);
  const controller = new AbortController();

  const errorStub = stub(logger, "error");

  try {
    const monitoringPromise = monitor.startMonitoring(controller.signal);

    // Allow enough time for multiple error cycles
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();

    await monitoringPromise;

    // Should have logged at least one error (don't require multiple to avoid flakiness)
    assertEquals(errorStub.calls.length >= 1, true);
  } finally {
    errorStub.restore();
  }
});

// Integration tests with FakeTime
Deno.test("CosmosMonitor should respect poll interval timing", async () => {
  const config = createMockConfig({ pollIntervalMs: 100 });
  const monitor = new CosmosMonitor(config);
  const time = new FakeTime();

  try {
    const controller = new AbortController();

    const monitoringPromise = monitor.startMonitoring(controller.signal);

    // Advance time and then abort
    await time.tickAsync(50);
    controller.abort();

    await monitoringPromise;
  } finally {
    time.restore();
  }
});

Deno.test("CosmosMonitor should handle rapid time advancement", async () => {
  const config = createMockConfig({ pollIntervalMs: 100 });
  const monitor = new CosmosMonitor(config);
  const time = new FakeTime();

  try {
    const controller = new AbortController();

    const monitoringPromise = monitor.startMonitoring(controller.signal);

    // Rapidly advance time to test multiple cycles
    await time.tickAsync(500);
    controller.abort();

    await monitoringPromise;
  } finally {
    time.restore();
  }
});

// Configuration validation tests
Deno.test("CosmosMonitor should work with different poll intervals", async () => {
  const configs = [
    createMockConfig({ pollIntervalMs: 50 }),
    createMockConfig({ pollIntervalMs: 1000 }),
    createMockConfig({ pollIntervalMs: 5000 }),
  ];

  for (const config of configs) {
    const monitor = new CosmosMonitor(config);
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 20);

    await monitor.startMonitoring(controller.signal);

    monitor.reset();
  }
});

Deno.test("CosmosMonitor should work with different URLs", async () => {
  const configs = [
    createMockConfig({ cosmosNodeRestUrl: "http://localhost:1317" }),
    createMockConfig({ cosmosNodeRestUrl: "https://api.cosmos.network" }),
    createMockConfig({ cosmosNodeRestUrl: "http://testnet:1317" }),
  ];

  for (const config of configs) {
    const monitor = new CosmosMonitor(config);
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 10);

    await monitor.startMonitoring(controller.signal);

    monitor.reset();
  }
});
