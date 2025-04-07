/**
 * Configuration service for the application
 * Responsible for loading environment variables and providing typed access to them
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { app } from 'electron';

// Ensure app is ready before accessing app.getPath
let userDataPath: string;
if (app.isReady()) {
  userDataPath = app.getPath('userData');
} else {
  userDataPath = '';
  app.whenReady().then(() => {
    userDataPath = app.getPath('userData');
  });
}

class ConfigService {
  private config: Record<string, string | undefined> = {};
  
  constructor() {
    this.loadConfig();
  }
  
  private loadConfig(): void {
    // Load environment variables from .env file
    dotenv.config();
    
    // Set default values and use environment variables if available
    this.config = {
      // Supabase configuration
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      
      // ElectricSQL configuration
      ELECTRIC_URL: process.env.ELECTRIC_URL || 'http://localhost:5133',
      
      // Application configuration
      NODE_ENV: process.env.NODE_ENV || 'production',
      
      // Paths
      USER_DATA_PATH: userDataPath,
      DB_PATH: app.isReady() ? path.join(userDataPath, 'todo.db') : '',
      ELECTRIC_STORAGE_PATH: app.isReady() ? path.join(userDataPath, 'electric-sync.json') : '',
      OFFLINE_STORAGE_PATH: app.isReady() ? path.join(userDataPath, 'pending-operations.json') : '',
      
      // Sync configuration
      SYNC_INTERVAL: process.env.SYNC_INTERVAL || '30000', // 30 seconds
      CONNECTION_CHECK_INTERVAL: process.env.CONNECTION_CHECK_INTERVAL || '10000', // 10 seconds
      MAX_CONSECUTIVE_FAILURES: process.env.MAX_CONSECUTIVE_FAILURES || '3',
    };
    
    // Update paths when app is ready if they weren't set
    if (!app.isReady()) {
      app.whenReady().then(() => {
        const updatedUserDataPath = app.getPath('userData');
        this.config.USER_DATA_PATH = updatedUserDataPath;
        this.config.DB_PATH = path.join(updatedUserDataPath, 'todo.db');
        this.config.ELECTRIC_STORAGE_PATH = path.join(updatedUserDataPath, 'electric-sync.json');
        this.config.OFFLINE_STORAGE_PATH = path.join(updatedUserDataPath, 'pending-operations.json');
      });
    }
  }
  
  // Generic getter with type checking
  public get<T extends string | number | boolean>(key: string, type: 'string' | 'number' | 'boolean' = 'string'): T | undefined {
    const value = this.config[key];
    
    if (value === undefined) {
      return undefined;
    }
    
    switch (type) {
      case 'number':
        return Number(value) as T;
      case 'boolean':
        return (value === 'true' || value === '1') as unknown as T;
      case 'string':
      default:
        return value as unknown as T;
    }
  }
  
  // Get config value with default fallback
  public getOrDefault<T extends string | number | boolean>(
    key: string, 
    defaultValue: T, 
    type: 'string' | 'number' | 'boolean' = 'string'
  ): T {
    const value = this.get<T>(key, type);
    return value !== undefined ? value : defaultValue;
  }
  
  // Type-specific getters
  public getString(key: string): string | undefined {
    return this.get<string>(key, 'string');
  }
  
  public getNumber(key: string): number | undefined {
    return this.get<number>(key, 'number');
  }
  
  public getBoolean(key: string): boolean | undefined {
    return this.get<boolean>(key, 'boolean');
  }
  
  // Required getters that throw if value is missing
  public getRequiredString(key: string): string {
    const value = this.getString(key);
    if (value === undefined) {
      throw new Error(`Required configuration value not found: ${key}`);
    }
    return value;
  }
  
  public getRequiredNumber(key: string): number {
    const value = this.getNumber(key);
    if (value === undefined) {
      throw new Error(`Required configuration value not found: ${key}`);
    }
    return value;
  }
  
  public getRequiredBoolean(key: string): boolean {
    const value = this.getBoolean(key);
    if (value === undefined) {
      throw new Error(`Required configuration value not found: ${key}`);
    }
    return value;
  }
  
  // Convenience methods for commonly used configs
  public getDbPath(): string {
    // Wait until app is ready to get the correct path
    if (!this.config.DB_PATH && app.isReady()) {
      this.config.DB_PATH = path.join(app.getPath('userData'), 'todo.db');
    }
    return this.getRequiredString('DB_PATH');
  }
  
  public getElectricUrl(): string {
    return this.getOrDefault('ELECTRIC_URL', 'http://localhost:5133');
  }
  
  public getSupabaseUrl(): string {
    return this.getRequiredString('SUPABASE_URL');
  }
  
  public getSupabaseKey(): string {
    return this.getRequiredString('SUPABASE_SERVICE_ROLE_KEY');
  }
  
  public isDevMode(): boolean {
    return this.getOrDefault<string>('NODE_ENV', 'production') === 'development';
  }
}

// Export as singleton
export const configService = new ConfigService();
export default configService;