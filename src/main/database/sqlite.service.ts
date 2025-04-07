/**
 * SQLite database service
 * Manages database connection, schema setup, and provides CRUD operations
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import configService from '../config';
import { getLogger } from '../logging';
import { DatabaseError } from '../error/app.error';

const logger = getLogger('SQLiteService');

export class SQLiteService {
  private db: Database.Database | null = null;
  private dbPath: string = '';
  
  constructor() {
    if (app.isReady()) {
      this.initialize();
    } else {
      app.whenReady().then(() => this.initialize());
    }
  }
  
  /**
   * Initialize the database connection and schema
   */
  private initialize(): void {
    try {
      // Get the database path from config
      this.dbPath = configService.getDbPath();
      logger.info(`Initializing SQLite database at: ${this.dbPath}`);
      
      // Create directory if it doesn't exist
      const dirPath = path.dirname(this.dbPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      // Create database connection
      this.db = new Database(this.dbPath, {
        // Add any required options here
        verbose: configService.isDevMode() ? console.log : undefined
      });
      
      // Setup database schema
      this.setupSchema();
      
      logger.info('SQLite database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize SQLite database', error);
      throw new DatabaseError(`Failed to initialize database: ${(error as Error).message}`);
    }
  }
  
  /**
   * Set up the database schema (tables, indexes, etc.)
   */
  private setupSchema(): void {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }
    
    try {
      // Create todos table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          completed INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Add any required indexes
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at)
      `);
      
      logger.info('Database schema setup completed');
    } catch (error) {
      logger.error('Failed to set up database schema', error);
      throw new DatabaseError(`Failed to set up database schema: ${(error as Error).message}`);
    }
  }
  
  /**
   * Get the database instance
   * @throws DatabaseError if database is not initialized
   */
  public getDbInstance(): Database.Database {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }
    return this.db;
  }
  
  /**
   * Execute a SQL query with parameters
   * @param sql The SQL query to execute
   * @param params The parameters to bind to the query
   * @returns The statement info (changes, lastInsertRowid)
   */
  public execute(sql: string, params: any[] = []): Database.RunResult {
    try {
      if (!this.db) {
        throw new DatabaseError('Database not initialized');
      }
      
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    } catch (error) {
      logger.error(`Error executing SQL: ${sql}`, { error, params });
      throw new DatabaseError(`Failed to execute SQL: ${(error as Error).message}`);
    }
  }
  
  /**
   * Query a single row from the database
   * @param sql The SQL query to execute
   * @param params The parameters to bind to the query
   * @returns The first row as an object, or undefined if no rows match
   */
  public queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
    try {
      if (!this.db) {
        throw new DatabaseError('Database not initialized');
      }
      
      const stmt = this.db.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } catch (error) {
      logger.error(`Error querying one row with SQL: ${sql}`, { error, params });
      throw new DatabaseError(`Failed to query database: ${(error as Error).message}`);
    }
  }
  
  /**
   * Query multiple rows from the database
   * @param sql The SQL query to execute
   * @param params The parameters to bind to the query
   * @returns An array of rows as objects
   */
  public queryAll<T = any>(sql: string, params: any[] = []): T[] {
    try {
      if (!this.db) {
        throw new DatabaseError('Database not initialized');
      }
      
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      logger.error(`Error querying all rows with SQL: ${sql}`, { error, params });
      throw new DatabaseError(`Failed to query database: ${(error as Error).message}`);
    }
  }
  
  /**
   * Begin a transaction
   * @returns A transaction object
   */
  public transaction<T>(fn: (db: Database.Database) => T): T {
    try {
      if (!this.db) {
        throw new DatabaseError('Database not initialized');
      }
      
      const tx = this.db.transaction(fn);
      return tx(this.db);
    } catch (error) {
      logger.error('Error executing transaction', error);
      throw new DatabaseError(`Failed to execute transaction: ${(error as Error).message}`);
    }
  }
  
  /**
   * Close the database connection
   */
  public close(): void {
    if (this.db) {
      try {
        this.db.close();
        this.db = null;
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error closing database connection', error);
      }
    }
  }
}

// Export as singleton
export const sqliteService = new SQLiteService();
export default sqliteService;