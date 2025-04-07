# ElectricSQL + Supabase Todo App

This Electron TypeScript application demonstrates bidirectional sync between a local SQLite database and Supabase using ElectricSQL.

## Features

- Offline-first functionality with local SQLite storage
- Bidirectional sync with Supabase when online
- Automatic sync when connectivity is restored
- Pending operations tracking for offline changes
- Real-time sync status display

## Setup Instructions

### Prerequisites

- Node.js and npm
- Docker and Docker Compose
- A Supabase account with a project

### Supabase Setup

1. Log in to your Supabase dashboard
2. Go to the SQL Editor
3. Copy and paste the contents of the `supabase/schema.sql` file
4. Execute the SQL commands to create the necessary schema

### Environment Variables

The application uses the following environment variables from the `.env` file:

```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_DB_PASSWORD=your-db-password
SUPABASE_JWT_SECRET=your-jwt-secret
SUPABASE_DB_CONNECTION_STRING=postgresql://postgres:password@db.your-project-id.supabase.co:5432/postgres
ELECTRIC_URL=https://your-project-id.supabase.co/electric
```

### Running the ElectricSQL Sync Service

1. Navigate to the `docker` directory
2. Run the ElectricSQL sync service:

```bash
docker-compose up -d
```

This will start the ElectricSQL sync service that connects to your Supabase database.

### Running the Application

1. Install dependencies:

```bash
npm install
```

2. Start the application:

```bash
npm start
```

## Architecture

### Components

1. **ElectricClient**: Handles communication with the ElectricSQL sync service via HTTP API
2. **OfflineStorageManager**: Tracks pending operations when offline
3. **Main Process**: Manages the SQLite database and coordinates sync operations
4. **Renderer Process**: Displays todos and sync status to the user

### Sync Flow

1. When online, changes are immediately synced to Supabase via ElectricSQL
2. When offline, changes are stored locally and tracked as pending operations
3. When connectivity is restored, pending operations are processed and synced
4. Periodic connection checking detects network status changes

## Development

### Project Structure

- `src/main/index.ts`: Main process with database and sync logic
- `src/main/electric-client.ts`: ElectricSQL HTTP client implementation
- `src/main/offline-storage.ts`: Offline storage manager
- `src/preload/index.ts`: Preload script exposing IPC handlers
- `src/renderer/index.ts`: Renderer process UI logic
- `docker/docker-compose.yaml`: Docker Compose configuration for ElectricSQL

### Building

```bash
npm run build
```

### Packaging

```bash
npm run package
```

## License

MIT
