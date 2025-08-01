import { load } from "dotenv";
import { ConfigurationError } from "src/types/result.ts";

export interface Config {
  applicationPort: number;
  pollIntervalMs: number;
  cosmosNodeRestUrl: string;
  cicdTriggerToken: string;
  cicdPersonalAccessToken: string;
  cicdUpdateBranch: string;
  cicdProjectApiUrl: string;
  cicdVariables: string;
}

const REQUIRED_KEYS: ReadonlyArray<keyof Config> = [
  "cosmosNodeRestUrl",
  "cicdTriggerToken",
  "cicdPersonalAccessToken",
  "cicdUpdateBranch",
  "cicdProjectApiUrl",
];

const ENV_VAR_MAPPING: Record<keyof Config, string> = {
  cosmosNodeRestUrl: "COSMOS_NODE_REST_URL",
  cicdTriggerToken: "CICD_TRIGGER_TOKEN",
  cicdPersonalAccessToken: "CICD_PERSONAL_ACCESS_TOKEN",
  cicdUpdateBranch: "CICD_UPDATE_BRANCH",
  cicdProjectApiUrl: "CICD_PROJECT_API_URL",
  applicationPort: "APPLICATION_PORT",
  pollIntervalMs: "POLL_INTERVAL_MS",
  cicdVariables: "CICD_VARIABLES",
};

let configCache: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (configCache) {
    return configCache;
  }

  await load({
    export: true,
    allowEmptyValues: true,
    examplePath: null,
  });

  const applicationPortStr = Deno.env.get("APPLICATION_PORT") ?? "8080";
  const pollIntervalMsStr = Deno.env.get("POLL_INTERVAL_MS") ?? "2000";

  const applicationPort = parseInt(applicationPortStr, 10);
  const pollIntervalMs = parseInt(pollIntervalMsStr, 10);

  if (isNaN(applicationPort) || applicationPort <= 0) {
    throw new ConfigurationError(
      `Invalid APPLICATION_PORT: "${applicationPortStr}"`,
    );
  }

  if (isNaN(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new ConfigurationError(
      `Invalid POLL_INTERVAL_MS: "${pollIntervalMsStr}"`,
    );
  }

  configCache = {
    applicationPort,
    pollIntervalMs,
    cosmosNodeRestUrl: Deno.env.get("COSMOS_NODE_REST_URL") ?? "",
    cicdTriggerToken: Deno.env.get("CICD_TRIGGER_TOKEN") ?? "",
    cicdPersonalAccessToken: Deno.env.get("CICD_PERSONAL_ACCESS_TOKEN") ?? "",
    cicdUpdateBranch: Deno.env.get("CICD_UPDATE_BRANCH") ?? "",
    cicdProjectApiUrl: Deno.env.get("CICD_PROJECT_API_URL") ?? "",
    cicdVariables: Deno.env.get("CICD_VARIABLES") ?? "",
  };

  const missingKeys = REQUIRED_KEYS.filter((key) => {
    const value = configCache![key];
    return value == null || value === "";
  });

  if (missingKeys.length > 0) {
    const missingEnvVars = missingKeys.map((key) => ENV_VAR_MAPPING[key]);
    const envVarList = missingEnvVars.map((envVar) => `  - ${envVar}`).join(
      "\n",
    );

    throw new ConfigurationError(
      `Missing or empty required environment variables:
${envVarList}`,
      missingEnvVars,
    );
  }

  return configCache;
}
