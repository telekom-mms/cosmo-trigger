/**
 * Transforms a plain object of CI/CD variables into GitLab CI/CD trigger variables
 * with 'variables[KEY]' keys.
 *
 * Example input:
 * {
 *   PROVIDER: "aws",
 *   REGION: "eu-central-1"
 * }
 *
 * Returns:
 * {
 *   "variables[PROVIDER]": "aws",
 *   "variables[REGION]": "eu-central-1"
 * }
 */
import { type Config } from "config/config.ts";
import { logError } from "src/utils/logger.ts";

export function parseCicdVariables(config: Config): Record<string, string> {
  const cicdVariablesRaw = config.cicdVariables;
  if (!cicdVariablesRaw) return {};

  let cicdVariables: Record<string, string>;

  try {
    cicdVariables = JSON.parse(cicdVariablesRaw);
  } catch (err) {
    logError("Invalid CICD_VARIABLES JSON format", err);
    throw err;
  }

  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(cicdVariables)) {
    variables[`variables[${key}]`] = value;
  }

  return variables;
}
