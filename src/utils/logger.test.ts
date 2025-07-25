import { logError, logger } from "src/utils/logger.ts";
import { assertSpyCall, stub } from "test-mock";

Deno.test("logError should correctly log an Error instance", () => {
  // Arrange: Stub the logger's error method to intercept calls and prevent console output.
  const errorStub = stub(logger, "error");

  try {
    const testError = new Error("Boom");
    const contextMessage = "CrashContext";

    // Act: Call the function under test.
    logError(contextMessage, testError);

    // Assert: Verify that the stubbed logger.error was called exactly once
    // with the expected formatted message.
    assertSpyCall(errorStub, 0, {
      args: [`${contextMessage}: ${testError.message}`],
    });
  } finally {
    // Teardown: Restore the original logger.error method to prevent test pollution.
    errorStub.restore();
  }
});

Deno.test("logError should correctly log a non-Error value", () => {
  // Arrange: Stub the logger's error method.
  const errorStub = stub(logger, "error");

  try {
    const testError = "Missing data";
    const contextMessage = "DataLoad";

    // Act: Call the function under test with a string instead of an Error object.
    logError(contextMessage, testError);

    // Assert: Verify the call was made with the correctly stringified message.
    assertSpyCall(errorStub, 0, {
      args: [`${contextMessage}: ${String(testError)}`],
    });
  } finally {
    // Teardown: Restore the original method.
    errorStub.restore();
  }
});
