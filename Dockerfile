# Use the official Deno image as the base
# hadolint ignore=DL3026
FROM denoland/deno:alpine-2.4.2

LABEL author="VaaS Team" \
      contact="staking@telekom-mms.com" \
      vendor="Telekom MMS GmbH" \
      name="CosmoTrigger" \
      description="Build image"

# Arguments for user and group IDs and names
# Using non-reserved UIDs/GIDs (e.g., >= 1000)
ARG APP_USER_NAME=cosmo-trigger
ARG APP_USER_UID=1001
ARG APP_GROUP_NAME=cosmo-trigger
ARG APP_GROUP_GID=1001

# Create a non-root group and user
# -S: create a system user/group (no password, no home dir by default unless specified)
# -G: specify group
# -u: specify UID
# -g: specify GID for group
RUN addgroup -S -g ${APP_GROUP_GID} ${APP_GROUP_NAME} && \
    adduser -S -u ${APP_USER_UID} -G ${APP_GROUP_NAME} ${APP_USER_NAME}

# --- START: Application Environment Variables ---
# These provide default values. Sensitive variables are intentionally left
# empty or with placeholder values and MUST be provided securely at runtime
# (e.g., via Kubernetes Secrets managed by Helm).

# Matches Deno code: Deno.env.get("APPLICATION_PORT") ?? ""
# We provide a common default here.
ENV APPLICATION_PORT="8000"

# Matches Deno code: Deno.env.get("COSMOS_NODE_REST_URL") ?? ""
ENV COSMOS_NODE_REST_URL=""

# NOTE: Sensitive environment variables are expected at runtime:
# - CICD_TRIGGER_TOKEN: Must be provided via K8s Secret at runtime
# - CICD_PERSONAL_ACCESS_TOKEN: Must be provided via K8s Secret at runtime
# These are intentionally NOT set in Dockerfile for security compliance.

# Matches Deno code: Deno.env.get("CICD_REPOSITORY_BRANCH") ?? ""
# Consider changing Deno code's default if "main" or similar is always preferred.
ENV CICD_REPOSITORY_BRANCH=""

# Matches Deno code: Deno.env.get("CICD_PROJECT_API_URL") ?? ""
ENV CICD_PROJECT_API_URL=""

# Matches Deno code: Deno.env.get("CICD_VARIABLES") ?? ""
ENV CICD_VARIABLES=""

# Define DENO_DIR environment variable for caching. This is separate from app env vars.
ENV DENO_DIR=/opt/deno-cache
# --- END: Application Environment Variables ---

# Set working directory
WORKDIR /app

# Create DENO_DIR, set ownership and permissions.
# This allows the non-root user to write to the cache during `deno cache`.
RUN mkdir -p ${DENO_DIR} && \
    chown ${APP_USER_UID}:${APP_GROUP_GID} ${DENO_DIR} && \
    chmod 750 ${DENO_DIR} # Owner rwx, group rx, others no access

# Copy source files and config, changing ownership to the non-root user
COPY --chown=${APP_USER_UID}:${APP_GROUP_GID} . .

# Cache dependencies first while files have default permissions
RUN deno cache src/app.ts

# Set appropriate permissions for the application files after caching
# Directories: rwxr-xr-x (755) for owner and group
# Files: rw-r--r-- (644) for owner read/write, group and others read
RUN find /app -type d -exec chmod 755 {} \; && \
    find /app -type f -exec chmod 644 {} \;

# Switch to the non-root user for runtime
USER ${APP_USER_NAME}

# Expose the port your application listens on.
# This uses the APPLICATION_PORT env var defined above.
EXPOSE ${APPLICATION_PORT}

# Run the app as the non-root user
# Deno permissions (--allow-*) are specific to Deno's sandbox, not OS capabilities.
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "src/app.ts"]
