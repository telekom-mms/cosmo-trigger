import { type Config } from "config/config.ts";
import {
  fetchGitlabPipelineStatus,
  triggerGitlabUpdatePipeline,
} from "src/service/gitlab.ts";
import { assertEquals } from "test-assert";

const PIPELINE_ID = 456;

function createMockConfig(): Config {
  return {
    applicationPort: 8080,
    pollIntervalMs: 2000,
    cosmosNodeRestUrl: "http://localhost:1317",
    cicdTriggerToken: "test-token",
    cicdPersonalAccessToken: "test-pat",
    cicdUpdateBranch: "main",
    cicdProjectApiUrl: "https://gitlab.example.com/api/v4/projects/123",
    cicdVariables: "{}",
  };
}

async function withMockedFetch<T>(
  fetchImpl: () => Promise<Response>,
  testFn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fetchImpl;
    return await testFn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Mock response types
interface MockPipelineResponse {
  id: number;
  project_id: number;
  ref: string;
  status: string;
  user: {
    username: string;
    name: string;
  };
  web_url: string;
}

interface MockStatusResponse {
  status: string;
}

// Helper function to create a mock pipeline response
function createMockPipelineResponse(
  overrides: Partial<MockPipelineResponse> = {},
): MockPipelineResponse {
  return {
    id: 12345,
    project_id: 67890,
    ref: "main",
    status: "pending",
    user: {
      username: "test-user",
      name: "Test User",
    },
    web_url: "https://gitlab.example.com/project/-/pipelines/12345",
    ...overrides,
  };
}

// Helper function to create a mock status response
function createMockStatusResponse(status: string): MockStatusResponse {
  return { status };
}

// Helper function to create a mock fetch response
function createMockResponse(
  body: unknown,
  options: { ok?: boolean; status?: number } = {},
): Response {
  const { ok = true, status = 200 } = options;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

// Helper function to create a mock error response
function createMockErrorResponse(
  errorText: string,
  status: number = 400,
): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("Invalid JSON")),
    text: () => Promise.resolve(errorText),
  } as Response;
}

Deno.test(
  "triggerGitlabUpdatePipeline should trigger pipeline successfully",
  async () => {
    const mockPipeline = createMockPipelineResponse({
      id: 12345,
      status: "pending",
    });
    const mockStatusResponse = createMockStatusResponse("failed"); // Use failed to avoid monitorChain

    let fetchCallCount = 0;
    await withMockedFetch(() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return Promise.resolve(createMockResponse(mockPipeline));
      } else {
        return Promise.resolve(createMockResponse(mockStatusResponse));
      }
    }, async () => {
      const result = await triggerGitlabUpdatePipeline(createMockConfig());
      assertEquals(fetchCallCount, 2);
      assertEquals(result, false); // Pipeline failed
    });
  },
);

Deno.test(
  "triggerGitlabUpdatePipeline should not resume monitoring when pipeline fails",
  async () => {
    const mockPipeline = createMockPipelineResponse({
      id: 12345,
      status: "pending",
    });
    const mockStatusResponse = createMockStatusResponse("failed");

    let fetchCallCount = 0;
    await withMockedFetch(() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return Promise.resolve(createMockResponse(mockPipeline));
      } else {
        return Promise.resolve(createMockResponse(mockStatusResponse));
      }
    }, async () => {
      const result = await triggerGitlabUpdatePipeline(createMockConfig());
      assertEquals(fetchCallCount, 2);
      assertEquals(result, false); // Pipeline failed
    });
  },
);

Deno.test(
  "triggerGitlabUpdatePipeline should return true when pipeline succeeds",
  async () => {
    const mockPipeline = createMockPipelineResponse({
      id: 12345,
      status: "pending",
    });
    const mockStatusResponse = createMockStatusResponse("success");

    let fetchCallCount = 0;
    await withMockedFetch(() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return Promise.resolve(createMockResponse(mockPipeline));
      } else {
        return Promise.resolve(createMockResponse(mockStatusResponse));
      }
    }, async () => {
      const result = await triggerGitlabUpdatePipeline(createMockConfig());
      assertEquals(fetchCallCount, 2);
      assertEquals(result, true); // Pipeline succeeded
    });
  },
);

Deno.test(
  "triggerGitlabUpdatePipeline should handle GitLab API errors gracefully",
  async () => {
    await withMockedFetch(() => {
      return Promise.resolve(createMockErrorResponse("Bad Request", 400));
    }, async () => {
      const result = await triggerGitlabUpdatePipeline(createMockConfig());
      assertEquals(result, false); // Should return false on error
    });
  },
);

Deno.test(
  "fetchGitlabPipelineStatus should return success status immediately",
  async () => {
    const mockStatusResponse = createMockStatusResponse("success");

    const result = await withMockedFetch(() => {
      return Promise.resolve(createMockResponse(mockStatusResponse));
    }, async () => {
      return await fetchGitlabPipelineStatus(PIPELINE_ID, createMockConfig());
    });

    assertEquals(result, "success");
  },
);

Deno.test(
  "fetchGitlabPipelineStatus should return failed status immediately",
  async () => {
    const mockStatusResponse = createMockStatusResponse("failed");

    const result = await withMockedFetch(() => {
      return Promise.resolve(createMockResponse(mockStatusResponse));
    }, async () => {
      return await fetchGitlabPipelineStatus(PIPELINE_ID, createMockConfig());
    });

    assertEquals(result, "failed");
  },
);

Deno.test(
  "fetchGitlabPipelineStatus should return failed when GitLab API returns non-200 status",
  async () => {
    await withMockedFetch(() => {
      return Promise.resolve(createMockErrorResponse("Bad Request", 400));
    }, async () => {
      const result = await fetchGitlabPipelineStatus(
        PIPELINE_ID,
        createMockConfig(),
      );
      assertEquals(result, "failed");
    });
  },
);

Deno.test(
  "fetchGitlabPipelineStatus should poll until terminal status is reached",
  async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let fetchCallCount = 0;

    try {
      // Mock setTimeout to execute immediately
      globalThis.setTimeout = (fn: () => void) => {
        fn();
        return 0;
      };

      const result = await withMockedFetch(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return Promise.resolve(
            createMockResponse(createMockStatusResponse("pending")),
          );
        } else {
          return Promise.resolve(
            createMockResponse(createMockStatusResponse("success")),
          );
        }
      }, async () => {
        return await fetchGitlabPipelineStatus(PIPELINE_ID, createMockConfig());
      });

      assertEquals(result, "success");
      assertEquals(fetchCallCount, 2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  },
);
