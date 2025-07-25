// src/service/cosmos.test.ts
import {
  getBlockHeight,
  getChainIdentity,
  getUpgradePlanBlockHeight,
} from "src/service/cosmos.ts";
import { assertEquals } from "test-assert";
import { assertSpyCall, spy } from "test-mock";

Deno.test(
  "getBlockHeight should return block height on successful API call",
  async () => {
    const mockResponseData = {
      block: {
        header: {
          height: "12345",
        },
      },
    };
    const originalFetch = globalThis.fetch;
    const mockFetch = spy(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockResponseData), { status: 200 }),
      )
    );
    globalThis.fetch = mockFetch;
    try {
      const height = await getBlockHeight("http://dummy-url");
      assertEquals(height, 12345);
      assertSpyCall(mockFetch, 0, {
        args: [
          `http://dummy-url/cosmos/base/tendermint/v1beta1/blocks/latest`,
          undefined,
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

Deno.test(
  "getBlockHeight should return null when the API call fails",
  async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = spy(() => Promise.reject(new Error("Network failure")));
    globalThis.fetch = mockFetch;
    try {
      const height = await getBlockHeight("http://dummy-url");
      assertEquals(height, null);
      assertSpyCall(mockFetch, 0, {
        args: [
          `http://dummy-url/cosmos/base/tendermint/v1beta1/blocks/latest`,
          undefined,
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

Deno.test(
  "getUpgradePlan should return plan height when a plan exists",
  async () => {
    const mockResponseData = {
      plan: {
        name: "v2-upgrade",
        height: "99999",
      },
    };
    const originalFetch = globalThis.fetch;
    const mockFetch = spy(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockResponseData), { status: 200 }),
      )
    );
    globalThis.fetch = mockFetch;
    try {
      const planHeight = await getUpgradePlanBlockHeight("http://dummy-url");
      assertEquals(planHeight, 99999);
      assertSpyCall(mockFetch, 0, {
        args: [
          `http://dummy-url/cosmos/upgrade/v1beta1/current_plan`,
          undefined,
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

Deno.test(
  "getUpgradePlan should return null when no upgrade plan exists",
  async () => {
    const mockResponseData = {
      plan: null,
    };
    const originalFetch = globalThis.fetch;
    const mockFetch = spy(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockResponseData), { status: 200 }),
      )
    );
    globalThis.fetch = mockFetch;
    try {
      const planHeight = await getUpgradePlanBlockHeight("http://dummy-url");
      assertEquals(planHeight, null);
      assertSpyCall(mockFetch, 0, {
        args: [
          `http://dummy-url/cosmos/upgrade/v1beta1/current_plan`,
          undefined,
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

Deno.test(
  "getChainIdentity should return moniker and network on success",
  async () => {
    const mockResponseData = {
      default_node_info: {
        default_node_id: "node-id-123",
        listen_addr: "0.0.0.0:26656",
        network: "test-network-1",
        version: "v1.0.0",
        moniker: "test-moniker",
        other: {
          rpc_address: "localhost:26657",
        },
      },
    };
    const originalFetch = globalThis.fetch;
    const mockFetch = spy(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockResponseData), { status: 200 }),
      )
    );
    globalThis.fetch = mockFetch;
    try {
      const identity = await getChainIdentity("http://dummy-url");
      assertEquals(identity, {
        nodeId: "node-id-123",
        listenAddr: "0.0.0.0:26656",
        network: "test-network-1",
        moniker: "test-moniker",
        version: "v1.0.0",
        rpcAddress: "localhost:26657",
      });
      assertSpyCall(mockFetch, 0, {
        args: [
          `http://dummy-url/cosmos/base/tendermint/v1beta1/node_info`,
          undefined,
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

Deno.test("getChainIdentity should return null on API failure", async () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = spy(() => Promise.reject(new Error("API is down")));
  globalThis.fetch = mockFetch;

  try {
    const identity = await getChainIdentity("http://dummy-url");
    assertEquals(identity, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
