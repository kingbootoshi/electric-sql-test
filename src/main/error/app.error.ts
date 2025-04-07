/**
 * Custom error classes for the application
 * Allows for consistent error handling and specific error types
 */

/**
 * Base application error class
 */
export class AppError extends Error {
  code: string;
  
  constructor(message: string, code: string = 'APP_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    // Capture stack trace properly
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends AppError {
  constructor(message: string, code: string = 'DATABASE_ERROR') {
    super(message, code);
  }
}

/**
 * Network-related errors (API calls)
 */
export class NetworkError extends AppError {
  constructor(message: string, code: string = 'NETWORK_ERROR') {
    super(message, code);
  }
}

/**
 * Configuration-related errors
 */
export class ConfigError extends AppError {
  constructor(message: string, code: string = 'CONFIG_ERROR') {
    super(message, code);
  }
}

/**
 * Sync-related errors
 */
export class SyncError extends AppError {
  constructor(message: string, code: string = 'SYNC_ERROR') {
    super(message, code);
  }
}

/**
 * Sync conflict errors
 */
export class SyncConflictError extends SyncError {
  constructor(message: string, code: string = 'SYNC_CONFLICT') {
    super(message, code);
  }
}

/**
 * Electric-specific errors
 */
export class ElectricError extends SyncError {
  constructor(message: string, code: string = 'ELECTRIC_ERROR') {
    super(message, code);
  }
}

/**
 * Supabase-specific errors
 */
export class SupabaseError extends SyncError {
  constructor(message: string, code: string = 'SUPABASE_ERROR') {
    super(message, code);
  }
}

/**
 * Offline-specific errors
 */
export class OfflineError extends SyncError {
  constructor(message: string, code: string = 'OFFLINE_ERROR') {
    super(message, code);
  }
}

/**
 * IPC-related errors
 */
export class IpcError extends AppError {
  constructor(message: string, code: string = 'IPC_ERROR') {
    super(message, code);
  }
}