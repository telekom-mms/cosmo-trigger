import { type Config } from "config/config.ts";
import { parseCicdVariables } from "src/utils/variable-parser.ts";
import { assertEquals, assertThrows } from "test-assert";
import { stub } from "test-mock";

Deno.test(
  "parseCicdVariables should correctly format a valid JSON string",
  () => {
    // Arrange: Create a mock config with valid JSON string.
    const mockConfig: Config = {
      applicationPort: 8080,
      pollIntervalMs: 2000,
      cosmosNodeRestUrl: "http://localhost:1317",
      cicdTriggerToken: "test-token",
      cicdPersonalAccessToken: "test-pat",
      cicdRepositoryBranch: "main",
      cicdProjectApiUrl: "https://gitlab.example.com/api/v4/projects/1234",
      cicdVariables: JSON.stringify({
        PROVIDER: "aws",
        REGION: "eu-central-1",
      }),
    };

    // Act: Execute the function under test.
    const result = parseCicdVariables(mockConfig);

    // Assert: Check that the output is transformed as expected.
    const expected = {
      "variables[PROVIDER]": "aws",
      "variables[REGION]": "eu-central-1",
    };
    assertEquals(result, expected);
  },
);

Deno.test(
  "parseCicdVariables should return an empty object for an empty string",
  () => {
    // Arrange: Create a mock config with empty string.
    const mockConfig: Config = {
      applicationPort: 8080,
      pollIntervalMs: 2000,
      cosmosNodeRestUrl: "http://localhost:1317",
      cicdTriggerToken: "test-token",
      cicdPersonalAccessToken: "test-pat",
      cicdRepositoryBranch: "main",
      cicdProjectApiUrl: "https://gitlab.example.com/api/v4/projects/1234",
      cicdVariables: "",
    };

    // Act: Execute the function.
    const result = parseCicdVariables(mockConfig);

    // Assert: The function should return an empty object without errors.
    assertEquals(result, {});
  },
);

Deno.test(
  "parseCicdVariables should throw an error for malformed JSON and not log",
  () => {
    // Arrange: Create a mock config with invalid JSON and stub console.error to silence output.
    const mockConfig: Config = {
      applicationPort: 8080,
      pollIntervalMs: 2000,
      cosmosNodeRestUrl: "http://localhost:1317",
      cicdTriggerToken: "test-token",
      cicdPersonalAccessToken: "test-pat",
      cicdRepositoryBranch: "main",
      cicdProjectApiUrl: "https://gitlab.example.com/api/v4/projects/1234",
      cicdVariables: "{ 'key': 'value' }", // Invalid JSON uses single quotes.
    };

    const consoleStub = stub(console, "error");

    try {
      // Act & Assert: Expect the function to throw a SyntaxError from JSON.parse.
      assertThrows(() => parseCicdVariables(mockConfig), SyntaxError);
    } finally {
      // Teardown: Always restore the stub.
      consoleStub.restore();
    }
  },
);
