/**
 * Logger service for structured logging using Winston
 * Provides consistent logging across the application while maintaining
 * flexibility and consistency in log levels, transports, and formatting.
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import winston from 'winston'; // Import winston
import configService from '../config';

// Define log levels (Winston uses these by default, but defining explicitly ensures consistency)
type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

// Define Winston log levels (aligns with npm levels)
const winstonLevels: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3, // Changed order to match winston/npm default
  debug: 4,   // Changed order to match winston/npm default
};

class Logger {
  private winstonLogger: winston.Logger; // Winston logger instance
  private currentLevel: LogLevel;
  private logFilePath: string | null = null;
  private consoleEnabled: boolean = true;
  private fileEnabled: boolean = false;
  private moduleLoggers: Map<string, LoggerInstance> = new Map(); // Cache module loggers
  
  constructor() {
    // Determine initial log level
    this.currentLevel = (configService.getString('LOG_LEVEL') as LogLevel) || 'info';
    this.consoleEnabled = configService.getOrDefault('LOG_TO_CONSOLE', true, 'boolean'); // Assuming a config for console
    this.fileEnabled = configService.getOrDefault('LOG_TO_FILE', false, 'boolean');
    
    // Initialize Winston logger
    this.winstonLogger = winston.createLogger({
      levels: winstonLevels,
      level: this.currentLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }), // Log stack traces for errors
        winston.format.splat(),
        winston.format.json() // Log in JSON format to file
      ),
      transports: [], // Transports will be added dynamically
      exitOnError: false, // Don't exit on handled exceptions
    });
    
    // Setup file path (needs to happen before adding transports)
    if (this.fileEnabled) {
      if (app.isReady()) {
        this.setupLogFile();
      } else {
        // Defer setup until app is ready
        app.whenReady().then(() => {
          this.setupLogFile();
          this.reconfigureTransports(); // Reconfigure after path is set
        });
      }
    }
    
    // Initial transport configuration
    this.reconfigureTransports();
  }
  
  private setupLogFile(): void {
    // Ensure this runs only once or handles re-running safely if needed
    if (this.logFilePath) return; // Already set up
    
    try {
      const userDataPath = app.getPath('userData');
      const logsDir = path.join(userDataPath, 'logs');
      
      // Create logs directory if it doesn't exist
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      // Create a log file name with current date
      const now = new Date();
      const fileName = `app-${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}.log`;
      this.logFilePath = path.join(logsDir, fileName);
    } catch(error) {
      // Fallback if path setting fails
      console.error('src/main/logging/logger.ts: Failed to set up log file path:', error);
      this.fileEnabled = false; // Disable file logging if setup fails
      this.logFilePath = null;
    }
  }
  
  // Reconfigure Winston transports based on current settings
  private reconfigureTransports(): void {
    this.winstonLogger.clear(); // Remove existing transports
    
    if (this.consoleEnabled) {
      this.winstonLogger.add(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(), // Add colors for readability
          winston.format.printf(({ level, message, timestamp, module, data, stack }) => {
            const dataString = data ? ` ${JSON.stringify(data)}` : '';
            const moduleString = module ? ` [${module}]` : '';
            const logMessage = `[${timestamp}] [${level}]${moduleString} ${message}${dataString}`;
            // Include stack trace if available (usually for errors)
            return stack ? `${logMessage}
${stack}` : logMessage;
          })
        ),
        level: this.currentLevel, // Ensure console respects the current level
      }));
    }
    
    if (this.fileEnabled && this.logFilePath) {
      this.winstonLogger.add(new winston.transports.File({
        filename: this.logFilePath,
        format: winston.format.json(), // Keep file logs as JSON
        level: this.currentLevel, // Ensure file respects the current level
      }));
    } else if (this.fileEnabled && !this.logFilePath) {
      // This case might happen if setupLogFile hasn't run yet due to app not being ready
      console.warn("src/main/logging/logger.ts: File logging enabled but log path not yet available. Will configure transport when app is ready.");
    }
  }
  
  // Get a cached child logger instance for a specific module
  public getLogger(module: string): LoggerInstance {
    if (!this.moduleLoggers.has(module)) {
      this.moduleLoggers.set(module, new LoggerInstance(this, module));
    }
    return this.moduleLoggers.get(module)!; // Non-null assertion as we just set it
  }
  
  // Log a message using Winston
  public log(level: LogLevel, module: string, message: string, data?: any): void {
    // Winston handles level checking internally based on logger's level
    // Pass module and data as metadata
    this.winstonLogger.log(level, message, { module, data });
  }
  
  // No need for shouldLog method, Winston handles it
  
  // No need for logToConsole or logToFile methods, Winston handles transports
  
  // Set the current log level for all transports
  public setLevel(level: LogLevel): void {
    this.currentLevel = level;
    // Update level on the core logger and all transports
    this.winstonLogger.level = level;
    this.winstonLogger.transports.forEach(transport => {
      transport.level = level;
    });
  }
  
  // Enable or disable console logging
  public enableConsole(enabled: boolean): void {
    if (this.consoleEnabled !== enabled) {
      this.consoleEnabled = enabled;
      this.reconfigureTransports(); // Rebuild transports
    }
  }
  
  // Enable or disable file logging
  public enableFile(enabled: boolean): void {
    if (this.fileEnabled !== enabled) {
      this.fileEnabled = enabled;
      
      // Set up log file if enabling and not already set up
      if (enabled && !this.logFilePath && app.isReady()) {
        this.setupLogFile(); // Ensure path is set before reconfiguring
      } else if (enabled && !this.logFilePath && !app.isReady()) {
        console.warn(`src/main/logging/logger.ts: File logging enabled, but app not ready. Path setup deferred.`); // Log deferred setup
        // No need to call setupLogFile here, it's handled by the app.whenReady in constructor/enableFile
      }
      
      this.reconfigureTransports(); // Rebuild transports
    }
  }
}

// Logger instance for a specific module (remains largely the same)
class LoggerInstance {
  private logger: Logger; // Reference to the main Logger
  private module: string; // Module name for this instance
  
  constructor(logger: Logger, module: string) {
    this.logger = logger;
    this.module = module;
  }
  
  // Log error message
  public error(message: string, data?: any): void {
    this.logger.log('error', this.module, message, data);
  }
  
  // Log warning message
  public warn(message: string, data?: any): void {
    this.logger.log('warn', this.module, message, data);
  }
  
  // Log info message
  public info(message: string, data?: any): void {
    this.logger.log('info', this.module, message, data);
  }
  
  // Log debug message
  public debug(message: string, data?: any): void {
    this.logger.log('debug', this.module, message, data);
  }
  
  // Log verbose message
  public verbose(message: string, data?: any): void {
    this.logger.log('verbose', this.module, message, data);
  }
}

/**
 * Create and export a singleton instance of the main Logger.
 * This instance serves as the central point for configuring and accessing logging
 * throughout the application, ensuring consistency.
 */
export const rootLogger = new Logger();
// Export the singleton instance as the default export as well, maintaining compatibility
export default rootLogger;

// Example usage (optional, for testing)
/*
import logger from './logger'; // Import the default export

const appLogger = logger.getLogger('AppModule');
appLogger.info('Application starting...');
appLogger.debug('Debugging info', { userId: 123 });
appLogger.warn('Potential issue detected');
appLogger.error('Critical error occurred!', new Error('Something went wrong'));

logger.setLevel('debug'); // Change log level dynamically
appLogger.debug('This debug message should now appear');

// Test enabling/disabling transports
// logger.enableConsole(false);
// appLogger.info('This should not appear on console');
// logger.enableConsole(true);
// appLogger.info('Console logging re-enabled');

// logger.enableFile(true); // Needs app.ready to work fully initially
// Assuming app is ready or becomes ready:
// app.on('ready', () => {
//   logger.enableFile(true);
//   const fileLogger = logger.getLogger('FileTest');
//   fileLogger.info('This should be logged to file');
// });
*/