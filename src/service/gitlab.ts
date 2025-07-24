import { type Config } from "config/config.ts";
import {
  GitlabPipeline,
  PipelineStatusClassification,
} from "src/types/gitlab.ts";
import { isFailure } from "src/types/result.ts";
import { fetchJson, safeGet } from "src/utils/http.ts";
import { logger } from "src/utils/logger.ts";
import { parseCicdVariables } from "src/utils/variable-parser.ts";

/**
 * Categories of pipeline statuses.
 */
const TERMINAL_STATUSES = ["success", "failed", "canceled", "skipped"] as const;
const NON_TERMINAL_STATUSES = [
  "pending",
  "running",
  "manual",
  "created",
] as const;
const POLL_INTERVAL_MS = 10_000;

/**
 * Creates the request body for triggering a GitLab pipeline.
 *
 * @param config - The application configuration.
 * @returns URLSearchParams containing the pipeline trigger parameters.
 */
function createPipelineTriggerBody(config: Config): URLSearchParams {
  const cicdVariables = parseCicdVariables(config);
  return new URLSearchParams({
    token: config.cicdTriggerToken,
    ref: config.cicdRepositoryBranch,
    ...cicdVariables,
  });
}

/**
 * Parses the GitLab API response for a triggered pipeline.
 *
 * @param response - The HTTP response from GitLab API.
 * @returns Promise resolving to pipeline object or null on parse error.
 */
async function parsePipelineResponse(
  response: Response,
): Promise<GitlabPipeline | null> {
  try {
    return await response.json() as GitlabPipeline;
  } catch (jsonErr) {
    logger.error("Failed to parse GitLab API response as JSON:", jsonErr);
    return null;
  }
}

/**
 * Logs detailed information about a triggered pipeline.
 *
 * @param pipeline - The pipeline object from GitLab API response.
 */
function logPipelineInfo(pipeline: GitlabPipeline): void {
  logger.info(`Pipeline Details:
                                  - Pipeline ID: ${pipeline.id}
                                  - Project ID: ${pipeline.project_id}
                                  - Branch: ${pipeline.ref}
                                  - Status: ${pipeline.status}
                                  - Triggered by: ${pipeline.user?.username} (${pipeline.user?.name})
                                  - Pipeline URL: ${pipeline.web_url}`);
}

/**
 * Fetches the current status of a single GitLab pipeline.
 *
 * @param pipelineId - The ID of the pipeline to check.
 * @param config - The application configuration.
 * @returns Promise resolving to the pipeline status, or null on error.
 */
async function checkPipelineStatus(
  pipelineId: number,
  config: Config,
): Promise<string | null> {
  const pipelineStatusUrl =
    `${config.cicdProjectApiUrl}/pipelines/${pipelineId}`;

  const result = await fetchJson(pipelineStatusUrl, {
    headers: { "PRIVATE-TOKEN": config.cicdPersonalAccessToken },
  });

  if (isFailure(result)) {
    logger.error(`Failed to fetch pipeline status: ${result.error.message}`);
    return null;
  }

  const status = safeGet<string>(result.data.data, ["status"]);
  if (!status) {
    logger.error("Pipeline status not found in response");
    return null;
  }

  logger.info(`Pipeline status: ${status}`);
  return status;
}

/**
 * Classifies a pipeline status as terminal, non-terminal, or unknown.
 *
 * @param status - The pipeline status string.
 * @returns PipelineStatusClassification enum value.
 */
function classifyPipelineStatus(
  status: string,
): PipelineStatusClassification {
  if (TERMINAL_STATUSES.includes(status as typeof TERMINAL_STATUSES[number])) {
    return PipelineStatusClassification.TERMINAL;
  }
  if (
    NON_TERMINAL_STATUSES.includes(
      status as typeof NON_TERMINAL_STATUSES[number],
    )
  ) {
    return PipelineStatusClassification.NON_TERMINAL;
  }
  return PipelineStatusClassification.UNKNOWN;
}

/**
 * Triggers a GitLab CI/CD pipeline for the specified branch and configuration.
 *
 * The function sends a POST request to the GitLab API to trigger the pipeline.
 * It logs the pipeline details and waits for the pipeline to complete.
 * If the pipeline succeeds, it resumes the monitoring process.
 *
 * @param config - The application configuration.
 * @returns Promise<boolean> - true if pipeline succeeded, false if failed.
 */
export async function triggerGitlabUpdatePipeline(
  config: Config,
): Promise<boolean> {
  logger.info(`Triggering update pipeline`);
  const pipelineTriggerUrl = `${config.cicdProjectApiUrl}/trigger/pipeline`;

  try {
    const body = createPipelineTriggerBody(config);

    const response = await fetch(pipelineTriggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        `GitLab API error! status: ${response.status} - ${errorBody}`,
      );
      return false;
    }

    const pipeline = await parsePipelineResponse(response);
    if (!pipeline) return false;

    logPipelineInfo(pipeline);

    const finalStatus = await fetchGitlabPipelineStatus(pipeline.id, config);

    if (finalStatus === "success") {
      logger.info(`Pipeline with id ${pipeline.id} succeeded.`);
      return true;
    } else {
      logger.error(
        `Pipeline with id ${pipeline.id} finished with status: ${finalStatus}`,
      );
      return false;
    }
  } catch (err) {
    logger.error(
      `Error triggering update pipeline for api url: ${pipelineTriggerUrl}`,
      err,
    );
    return false;
  }
}

/**
 * Waits for a GitLab pipeline to complete by polling its status.
 *
 * The function sends GET requests to the GitLab API to check the pipeline status.
 * It waits for a specified interval between requests and continues polling until
 * the pipeline reaches a termination state (e.g., success, failed, canceled, skipped).
 *
 * @param pipelineId - The ID of the pipeline to check.
 * @param config - The application configuration.
 * @returns The final status of the pipeline (e.g., success, failed).
 */
export async function fetchGitlabPipelineStatus(
  pipelineId: number,
  config: Config,
): Promise<string> {
  try {
    const status = await checkPipelineStatus(pipelineId, config);
    if (!status) return "failed";

    const classification = classifyPipelineStatus(status);

    if (classification === PipelineStatusClassification.TERMINAL) {
      return status;
    }

    if (classification === PipelineStatusClassification.UNKNOWN) {
      logger.warn(
        `Unknown pipeline status: ${status}, treating as non-terminal`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    return fetchGitlabPipelineStatus(pipelineId, config);
  } catch (err) {
    logger.error(`Failed to fetch pipeline status:`, err);
    return "failed";
  }
}
