/**
 * Main Window Manager
 * Responsible for creating and managing the main application window
 */
import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import configService from '../config';
import { getLogger } from '../logging';

const logger = getLogger('MainWindow');

// Determine the correct preload script path based on environment
const preloadScriptProdPath = path.join(__dirname, '../preload/index.js');
const preloadScriptDevUrl = process.env['MAIN_WINDOW_PRELOAD_VITE_DEV_SERVER_URL'];

/**
 * Create main application window
 */
export function createMainWindow(): BrowserWindow {
  logger.info('Creating main window');
  
  // Create the browser window
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: preloadScriptDevUrl || preloadScriptProdPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  
  // Load the index.html
  if (configService.isDevMode()) {
    logger.info('Loading URL in development mode: http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
    
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../../renderer/index.html');
    logger.info(`Loading file in production mode: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }
  
  // Handle window events
  mainWindow.on('closed', () => {
    logger.info('Main window closed');
  });
  
  return mainWindow;
}

/**
 * Get the main window (or create if doesn't exist)
 */
export function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}