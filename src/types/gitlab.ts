/**
 * Represents a GitLab pipeline response from the API.
 */
export interface GitlabPipeline {
  id: number;
  project_id: number;
  ref: string;
  status: string;
  user?: {
    username: string;
    name: string;
  };
  web_url: string;
}

/**
 * Classification categories for GitLab pipeline statuses.
 */
export enum PipelineStatusClassification {
  TERMINAL = "terminal",
  NON_TERMINAL = "non-terminal",
  UNKNOWN = "unknown",
}
