import { isFailure, isSuccess, NetworkError } from "src/types/result.ts";
import { fetchJson, safeGet } from "src/utils/http.ts";
import { assertEquals } from "test-assert";

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

function createMockJsonResponse<T>(data: T, status: number = 200): Response {
  return createMockResponse(data, { ok: true, status });
}

// Test data interfaces
interface TestUser {
  id: number;
  name: string;
  email: string;
}

interface TestApiResponse {
  users: TestUser[];
  total: number;
}

// fetchJson Tests - Success Cases

Deno.test("fetchJson should return success result with valid JSON", async () => {
  const mockData: TestUser = {
    id: 1,
    name: "John Doe",
    email: "john@example.com",
  };

  await withMockedFetch(() => {
    return Promise.resolve(createMockJsonResponse(mockData));
  }, async () => {
    const result = await fetchJson<TestUser>("https://api.example.com/user");

    assertEquals(isSuccess(result), true);
    if (isSuccess(result)) {
      assertEquals(result.data.data, mockData);
      assertEquals(result.data.status, 200);
    }
  });
});

Deno.test(
  "fetchJson should handle different HTTP status codes correctly",
  async () => {
    const mockData = { message: "Created" };

    await withMockedFetch(() => {
      return Promise.resolve(createMockJsonResponse(mockData, 201));
    }, async () => {
      const result = await fetchJson<{ message: string }>(
        "https://api.example.com/create",
      );

      assertEquals(isSuccess(result), true);
      if (isSuccess(result)) {
        assertEquals(result.data.data, mockData);
        assertEquals(result.data.status, 201);
      }
    });
  },
);

Deno.test("fetchJson should pass through request options", async () => {
  const mockData = { success: true };
  let capturedUrl = "";
  let capturedOptions: RequestInit | undefined;

  await withMockedFetch(
    (url?: string | URL | Request, options?: RequestInit) => {
      capturedUrl = url?.toString() || "";
      capturedOptions = options;
      return Promise.resolve(createMockJsonResponse(mockData));
    },
    async () => {
      const requestOptions: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "data" }),
      };

      await fetchJson<{ success: boolean }>(
        "https://api.example.com/post",
        requestOptions,
      );

      assertEquals(capturedUrl, "https://api.example.com/post");
      assertEquals(capturedOptions?.method, "POST");
      assertEquals(
        (capturedOptions?.headers as Record<string, string>)["Content-Type"],
        "application/json",
      );
    },
  );
});

// fetchJson Tests - Error Cases

Deno.test(
  "fetchJson should return NetworkError for HTTP error status",
  async () => {
    await withMockedFetch(() => {
      return Promise.resolve(createMockErrorResponse("Not Found", 404));
    }, async () => {
      const result = await fetchJson<TestUser>("https://api.example.com/user");

      assertEquals(isFailure(result), true);
      if (isFailure(result)) {
        assertEquals(result.error instanceof NetworkError, true);
        assertEquals(result.error.message, "HTTP error! status: 404");
        assertEquals(result.error.statusCode, 404);
      }
    });
  },
);

Deno.test("fetchJson should handle JSON parsing errors", async () => {
  await withMockedFetch(() => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new TypeError("Invalid JSON response")),
      text: () => Promise.resolve("invalid json"),
    } as Response);
  }, async () => {
    const result = await fetchJson<TestUser>("https://api.example.com/user");

    assertEquals(isFailure(result), true);
    if (isFailure(result)) {
      assertEquals(result.error instanceof NetworkError, true);
      assertEquals(result.error.message, "Invalid JSON response");
      assertEquals(result.error.statusCode, 0);
    }
  });
});

Deno.test("fetchJson should handle network failures", async () => {
  await withMockedFetch(() => {
    return Promise.reject(new TypeError("Failed to fetch"));
  }, async () => {
    const result = await fetchJson<TestUser>("https://api.example.com/user");

    assertEquals(isFailure(result), true);
    if (isFailure(result)) {
      assertEquals(result.error instanceof NetworkError, true);
      assertEquals(result.error.message, "Failed to fetch");
    }
  });
});

Deno.test("fetchJson should handle fetch exceptions", async () => {
  await withMockedFetch(() => {
    return Promise.reject(new Error("Custom network error"));
  }, async () => {
    const result = await fetchJson<TestUser>("https://api.example.com/user");

    assertEquals(isFailure(result), true);
    if (isFailure(result)) {
      assertEquals(result.error instanceof NetworkError, true);
      assertEquals(result.error.message, "Custom network error");
    }
  });
});

Deno.test("fetchJson should consume response body on HTTP errors", async () => {
  let textCalled = false;

  await withMockedFetch(() => {
    return Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("Should not be called")),
      text: () => {
        textCalled = true;
        return Promise.resolve("Internal Server Error");
      },
    } as Response);
  }, async () => {
    const result = await fetchJson<TestUser>("https://api.example.com/user");

    assertEquals(isFailure(result), true);
    assertEquals(textCalled, true); // Verify response body was consumed
    if (isFailure(result)) {
      assertEquals(result.error instanceof NetworkError, true);
      assertEquals(result.error.message, "HTTP error! status: 500");
      assertEquals(result.error.statusCode, 500);
    }
  });
});

Deno.test("fetchJson should handle response body consumption errors gracefully", async () => {
  await withMockedFetch(() => {
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.reject(new Error("Should not be called")),
      text: () => Promise.reject(new Error("Failed to read response body")),
    } as Response);
  }, async () => {
    const result = await fetchJson<TestUser>("https://api.example.com/user");

    assertEquals(isFailure(result), true);
    if (isFailure(result)) {
      assertEquals(result.error instanceof NetworkError, true);
      assertEquals(result.error.message, "HTTP error! status: 404");
      assertEquals(result.error.statusCode, 404);
    }
  });
});

// safeGet Tests - Success Cases

Deno.test("safeGet should return value for valid path", () => {
  const testData = {
    user: {
      profile: {
        name: "John Doe",
        age: 30,
      },
      preferences: {
        theme: "dark",
      },
    },
  };

  const name = safeGet<string>(testData, ["user", "profile", "name"]);
  const age = safeGet<number>(testData, ["user", "profile", "age"]);
  const theme = safeGet<string>(testData, ["user", "preferences", "theme"]);

  assertEquals(name, "John Doe");
  assertEquals(age, 30);
  assertEquals(theme, "dark");
});

Deno.test("safeGet should handle empty path array", () => {
  const testData = { message: "hello" };
  const result = safeGet<typeof testData>(testData, []);

  assertEquals(result, testData);
});

Deno.test("safeGet should handle single-level access", () => {
  const testData = {
    name: "John",
    age: 25,
    active: true,
  };

  const name = safeGet<string>(testData, ["name"]);
  const age = safeGet<number>(testData, ["age"]);
  const active = safeGet<boolean>(testData, ["active"]);

  assertEquals(name, "John");
  assertEquals(age, 25);
  assertEquals(active, true);
});

// safeGet Tests - Edge Cases

Deno.test("safeGet should return null for non-existent path", () => {
  const testData = {
    user: {
      name: "John",
    },
  };

  const missing1 = safeGet<string>(testData, ["user", "email"]);
  const missing2 = safeGet<string>(testData, ["user", "profile", "name"]);
  const missing3 = safeGet<string>(testData, ["nonexistent"]);

  assertEquals(missing1, null);
  assertEquals(missing2, null);
  assertEquals(missing3, null);
});

Deno.test(
  "safeGet should return null for null/undefined object",
  () => {
    const nullResult = safeGet<string>(null, ["key"]);
    const undefinedResult = safeGet<string>(undefined, ["key"]);

    assertEquals(nullResult, null);
    assertEquals(undefinedResult, null);
  },
);

Deno.test(
  "safeGet should return null when path encounters non-object",
  () => {
    const testData = {
      user: {
        name: "John Doe",
        age: 30,
      },
    };

    // Try to access property of a string
    const result1 = safeGet<string>(testData, ["user", "name", "length"]);
    // Try to access property of a number
    const result2 = safeGet<string>(testData, ["user", "age", "toString"]);

    assertEquals(result1, null);
    assertEquals(result2, null);
  },
);

Deno.test("safeGet should handle array access", () => {
  const testData = {
    users: [
      { name: "John", id: 1 },
      { name: "Jane", id: 2 },
    ],
    tags: ["typescript", "deno", "testing"],
  };

  const firstUser = safeGet<{ name: string; id: number }>(testData, [
    "users",
    "0",
  ]);
  const secondUserName = safeGet<string>(testData, ["users", "1", "name"]);
  const firstTag = safeGet<string>(testData, ["tags", "0"]);
  const outOfBounds = safeGet<string>(testData, ["tags", "10"]);

  assertEquals(firstUser, { name: "John", id: 1 });
  assertEquals(secondUserName, "Jane");
  assertEquals(firstTag, "typescript");
  assertEquals(outOfBounds, null);
});

Deno.test("safeGet should handle complex nested structures", () => {
  const testData = {
    api: {
      v1: {
        endpoints: {
          users: {
            methods: ["GET", "POST"],
            auth: {
              required: true,
              types: ["bearer", "api-key"],
            },
          },
        },
      },
    },
  };

  const methods = safeGet<string[]>(testData, [
    "api",
    "v1",
    "endpoints",
    "users",
    "methods",
  ]);
  const authRequired = safeGet<boolean>(testData, [
    "api",
    "v1",
    "endpoints",
    "users",
    "auth",
    "required",
  ]);
  const firstAuthType = safeGet<string>(testData, [
    "api",
    "v1",
    "endpoints",
    "users",
    "auth",
    "types",
    "0",
  ]);
  const nonExistent = safeGet<string>(testData, [
    "api",
    "v2",
    "endpoints",
    "users",
  ]);

  assertEquals(methods, ["GET", "POST"]);
  assertEquals(authRequired, true);
  assertEquals(firstAuthType, "bearer");
  assertEquals(nonExistent, null);
});
