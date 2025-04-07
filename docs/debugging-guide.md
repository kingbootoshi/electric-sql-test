# ElectricSQL Debugging Guide

This guide provides step-by-step instructions for diagnosing and resolving issues with the ElectricSQL integration in the Electron application.

## Common Issues

### 1. "Header too long" Errors

#### Symptoms
- Error messages containing `(Bandit.HTTPError) Header too long` in logs
- Sync operations failing without clear error messages
- Writes failing but direct curl requests working fine

#### Diagnosis
1. Check the logs for the specific error message
2. Verify the request headers being sent (added detailed logging)
3. Compare with curl requests to the same endpoint

#### Resolution
- Ensure consistent headers across all requests
- Do not include extra custom headers
- Ensure request body is properly formatted JSON

### 2. Connection Detection Issues

#### Symptoms
- Application showing "offline" when ElectricSQL container is running
- Inconsistent sync status indicators
- Failed write operations with "Not online" errors

#### Diagnosis
1. Check ElectricSQL Docker container health status
2. Verify the health check endpoint response
3. Test direct connection to the health endpoint using curl

#### Resolution
- Use the root endpoint (`/`) for health checks instead of `/api/status`
- Accept any 2xx response as a valid connection indicator
- Add proper Accept headers to all requests

### 3. Sync Offset Management Issues

#### Symptoms
- Duplicate entries appearing in the application
- Missing entries that exist in Supabase
- Sync appears to reset from the beginning

#### Diagnosis
1. Check the sync offset values in logs
2. Verify the sync offset is being properly updated
3. Inspect the local storage sync state file

#### Resolution
- Ensure sync offset is properly saved after each sync
- Add additional logging around sync offset updates
- Validate response headers are being correctly processed

## Debugging Process

### Step 1: Enable Verbose Logging

Add the following environment variable before starting the application:
```
DEBUG=electric:*
```

### Step 2: Check Docker Container Status

```bash
# Check if container is running
docker ps | grep electric

# Check container logs
docker logs $(docker ps -q --filter name=electric)

# Check container health
docker inspect --format='{{.State.Health.Status}}' $(docker ps -q --filter name=electric)
```

### Step 3: Test API Endpoints Directly

```bash
# Test health endpoint
curl -v http://localhost:5133/

# Test shape endpoint
curl -v -H "Accept: application/json" http://localhost:5133/v1/shape?table=todos&offset=-1

# Test write endpoint
curl -v -X POST -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"table":"todos","values":{"id":"test-id","title":"Test","completed":false}}' \
  http://localhost:5133/v1/write
```

### Step 4: Check Application Logs

The application now includes detailed logging for all ElectricSQL operations:
- Connection status changes
- Request details for shape and write operations
- Response status codes and headers
- Detailed error information

### Step 5: Verify Data Flow

1. Create a todo in the application and check logs for write requests
2. Verify the todo appears in Supabase (using Supabase UI or SQL query)
3. Create a todo directly in Supabase and force sync in the application
4. Verify the todo appears in the application

## Exporting Logs for Support

If you need to share logs for troubleshooting:

```bash
# Export application logs
electron-vite-sqlite-with-electricsql > app-logs.txt 2>&1

# Export Docker logs
docker logs $(docker ps -q --filter name=electric) > docker-logs.txt 2>&1
```

## Key Log Messages to Look For

- `Electric service not reachable: [error details]` - Connection issues
- `Shape response status: [status code]` - Sync response status
- `Write response status: [status code]` - Write response status
- `Updated sync offset: [offset]` - Sync offset updates
- `Header too long error details: [error]` - Detailed header error information