# CosmoTrigger

**Note: CosmoTrigger currently only works for Gitlab pipelines.**

## Overview

CosmoTrigger is a Deno-based monitoring tool designed to track upcoming
upgrades of a Cosmos-SDK based network and trigger a self-defined GitLab
pipeline which ultimately executes the update.

## Features

- Monitors current block height and upgrade plan block height
- Triggers GitLab pipelines for automated updates
- Handles node availability gracefully with retry logic
- Configurable polling intervals and error handling
- Health check endpoint for monitoring integration

## Architecture

The application consists of three main services:

- **Monitor Service**: Tracks blockchain state and upgrade plans
- **Health Service**: Provides health check endpoints for monitoring
- **GitLab Service**: Handles pipeline triggering and status monitoring

## Configuration

The tool uses environment variables for configuration. These variables can be
provided through system environment variables or a local `.env` file.

### Environment Variables

<!-- markdownlint-disable MD013 -->
| Environment Variable           | Description                                           | Default Value |
|--------------------------------|-------------------------------------------------------|---------------|
| `APPLICATION_PORT`             | Port for the health check server                     | `8080`         |
| `POLL_INTERVAL_MS`             | Regular polling interval (should be lower than blocktime) | `2000`    |
| `COSMOS_NODE_REST_URL`         | REST URL of the Cosmos node                          | (Required)     |
| `CICD_TRIGGER_TOKEN`           | GitLab CI/CD trigger token (see [Gitlab documentation](https://docs.gitlab.com/ci/triggers/#create-a-pipeline-trigger-token) for more information)                                 | (Required)     |
| `CICD_PERSONAL_ACCESS_TOKEN`   | GitLab personal access token                         | (Required)     |
| `CICD_REPOSITORY_BRANCH`       | GitLab branch to trigger the pipeline on             | (Required)     |
| `CICD_PROJECT_API_URL`         | GitLab project API URL                               | (Required)     |
| `CICD_VARIABLES`               | JSON string of additional pipeline variables         | `""`           |
<!-- markdownlint-enable MD013 -->

### Configuration Methods

#### Method 1: Using .env File (Recommended)

Create a `.env` file in the same directory as your binary or source code.
A template `.env.example` file is provided in the repository. Copy and
modify it:

```bash
cp .env.example .env
# Edit .env with your specific values
```

#### Method 2: System Environment Variables

Export variables in your shell:

```bash
export APPLICATION_PORT=8080
export COSMOS_NODE_REST_URL=http://localhost:1317
export CICD_TRIGGER_TOKEN=your-trigger-token
# ... other variables
```

#### Method 3: Inline Environment Variables

Pass variables directly when running:

```bash
APPLICATION_PORT=8080 COSMOS_NODE_REST_URL=http://localhost:1317 ./cosmo-trigger-linux-x64
```

### Environment Variable Precedence

Environment variables are loaded with the following priority (**higher priority
overrides lower**):

1. **Inline environment variables** (highest priority)
2. **System environment variables**
3. **`.env` file values** (lowest priority)

## Running the Tool

### Method 1: Using Pre-built Binaries (Recommended)

Download the appropriate binary for your platform from the releases or build it
yourself:

```bash
./cosmo-trigger-<OS>-<PLATFORM>
```

**Prerequisites for Binary Method:**

- Create a `.env` file or set environment variables (see
  [Configuration](#configuration))
- Ensure binary has execute permissions on Unix systems:
  `chmod +x cosmo-trigger-*`

**Important Notes for Binaries:**

- ✅ **Compiled binaries automatically load `.env` files** from the current
  directory - no need to source `.env` files
- ✅ **System environment variables override `.env` file values**

### Method 2: Using Deno Runtime

#### Prerequisites for Deno

1. **Install Deno**
   Ensure you have [Deno](https://deno.land/) installed on your system.

2. **Set up environment variables**
   Create a `.env` file with the required variables or export them directly in
   your terminal (see [Configuration](#configuration)).

```bash
deno run --allow-net --allow-env --allow-read src/app.ts
```

Or use the predefined task:

```bash
deno task start
```

### Method 3: Using Docker

CosmoTrigger provides a ready-to-use Docker image that can be run with various
environment variable configurations.

#### Prerequisites for Docker

- **Docker**: Ensure Docker is installed and running on your system
- **Environment Variables**: Configure required variables using one of the
  methods below

#### Basic Usage

```bash
# Build the Docker image
docker build -t cosmo-trigger:latest .

# Run with environment variables
docker run -d \
  --name cosmo-trigger \
  -p 8080:8000 \
  -e COSMOS_NODE_REST_URL=http://localhost:1317 \
  -e CICD_TRIGGER_TOKEN=your-trigger-token \
  -e CICD_PERSONAL_ACCESS_TOKEN=your-personal-access-token \
  -e CICD_REPOSITORY_BRANCH=main \
  -e CICD_PROJECT_API_URL=https://gitlab.example.com/api/v4/projects/1234 \
  cosmo-trigger:latest
```

#### Environment Variable Configuration Methods

##### Method 1: Using Environment Variables Directly

See above.

##### Method 2: Using .env file

```bash
# Create .env file with your configuration
cp .env.example .env
# Edit .env with your values

# Run with environment file
docker run -d \
  --name cosmo-trigger \
  -p 8080:8000 \
  --env-file docker.env \
  cosmo-trigger:latest
```

#### Docker Compose

On Mac, you can use the `host.docker.internal` alias to access the host machine's services.

```bash
COSMOS_NODE_REST_URL=http://host.docker.internal:1317 docker compose up -d
```

## Building Binaries

### Prerequisites for Building

1. **Install Deno**
   Ensure you have [Deno](https://deno.land/) installed on your system.

### Build Commands

#### Build for Specific Platform

```bash
# Windows x86_64
deno task build:windows-x64

# Linux x86_64
deno task build:linux-x64

# Linux ARM64
deno task build:linux-arm64

# macOS x86_64 (Intel)
deno task build:macos-x64

# macOS ARM64 (Apple Silicon)
deno task build:macos-arm64

# Current platform
deno task build:current
```

#### Build for All Platforms

```bash
# Clean previous builds and build for all platforms
deno task build:all

# Clean build artifacts only
deno task build:clean
```

### Output Directory

All binaries are built to the `./dist/` directory with the following naming convention:

- `cosmo-trigger-windows-x64.exe` (Windows)
- `cosmo-trigger-linux-x64` (Linux x86_64)
- `cosmo-trigger-linux-arm64` (Linux ARM64)
- `cosmo-trigger-macos-x64` (macOS Intel)
- `cosmo-trigger-macos-arm64` (macOS Apple Silicon)
- `cosmo-trigger` (current platform when using `build:current`)

## Health Check

The application provides a health check endpoint for monitoring integration.

### Endpoints

- `GET /ready` - Returns HTTP 204 when service is ready, HTTP 503 when not ready
- Any other path returns HTTP 404

### Example Usage

```bash
# Check if service is ready
curl -f http://localhost:8080/ready

# In Kubernetes readiness probe
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Error Handling

The application implements comprehensive error handling:

- **Network Errors**: Automatic retry with exponential backoff
- **Node Unavailability**: Graceful handling with extended polling intervals
- **Pipeline Failures**: Proper error logging and monitoring resumption
- **Invalid Configuration**: Early validation with clear error messages

## Testing

The project includes unit tests with >80% coverage:

```bash
# Run all tests
deno task test

# Run specific test file
deno test --allow-net --allow-env --allow-read src/service/monitor.test.ts
```

## Troubleshooting

### .env File Issues

**Problem**: Binary doesn't load environment variables from `.env` file

```bash
Solution: Ensure .env file is in the same directory as the binary
✅ Correct: ./cosmo-trigger-linux-x64 (with .env in same folder)
❌ Incorrect: source .env && ./cosmo-trigger-linux-x64
```

**Problem**: Variables not being recognized

```bash
Solution: Check variable names match exactly (case-sensitive)
✅ Correct: COSMOS_NODE_REST_URL=http://localhost:1317
❌ Incorrect: cosmos_node_rest_url=http://localhost:1317
```

### Common Issues

1. **Port already in use**: Change `APPLICATION_PORT` in `.env`
2. **Node not reachable**: Verify `COSMOS_NODE_REST_URL` is correct
3. **GitLab API errors**: Check `CICD_*` tokens and URLs
4. **Permission denied**: Run `chmod +x cosmo-trigger-*` on Unix systems

## License

This project is licensed under the MIT License.
