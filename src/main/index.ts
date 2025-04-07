import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import { ElectricClient } from './electric-client';
import { OfflineStorageManager } from './offline-storage';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize database
let db: Database.Database;
let electricClient: ElectricClient;
let offlineStorage: OfflineStorageManager;
let syncStatus = 'offline';
let onlineCheckInterval: NodeJS.Timeout | null = null;

function initDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'todo.db');
  
  db = new Database(dbPath);
  
  // Create todos table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Initialize offline storage manager
  offlineStorage = new OfflineStorageManager();
  
  // Initialize ElectricSQL client
  electricClient = new ElectricClient();
  electricClient.initialize()
    .then(() => {
      console.log('ElectricSQL client initialized');
      updateSyncStatus(electricClient.isConnected() ? 'online' : 'offline');
      
      // Initial sync if online
      if (electricClient.isConnected()) {
        syncWithSupabase();
      }
      
      // Start online status check
      startOnlineStatusCheck();
    })
    .catch(error => {
      console.error('Failed to initialize ElectricSQL client:', error);
      updateSyncStatus('offline');
      
      // Start online status check even if initial connection fails
      startOnlineStatusCheck();
    });
}

// Start periodic online status check
function startOnlineStatusCheck() {
  if (onlineCheckInterval) {
    clearInterval(onlineCheckInterval);
  }
  
  // Keep track of consecutive failures to avoid flapping
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  
  onlineCheckInterval = setInterval(async () => {
    console.log('[startOnlineStatusCheck] Checking connection status');
    const wasOnline = electricClient.isConnected();
    const isNowOnline = await electricClient.checkConnection();
    
    // If status changed from offline to online
    if (!wasOnline && isNowOnline) {
      console.log('[startOnlineStatusCheck] Connection restored, syncing pending operations...');
      updateSyncStatus('online');
      consecutiveFailures = 0; // Reset failure counter
      
      try {
        // Process pending operations
        await processPendingOperations();
        
        // Then sync with Supabase
        await syncWithSupabase();
      } catch (error) {
        console.error('[startOnlineStatusCheck] Error processing operations or syncing:', error);
        // Recheck connection, might need to go offline
        if (!electricClient.isConnected()) {
          updateSyncStatus('offline');
        }
      }
    } 
    // If status changed from online to offline
    else if (wasOnline && !isNowOnline) {
      consecutiveFailures++;
      console.log(`[startOnlineStatusCheck] Connection check failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      
      // Only switch to offline mode after multiple consecutive failures
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log('[startOnlineStatusCheck] Connection lost, switching to offline mode');
        updateSyncStatus('offline');
        // Reset counter after taking action
        consecutiveFailures = 0;
      }
    } 
    // If staying online, consider attempting a periodic sync
    else if (isNowOnline && wasOnline) {
      consecutiveFailures = 0; // Reset failure counter on successful connections
    }
  }, 10000); // Check every 10 seconds
}

// Process pending operations when coming back online
async function processPendingOperations() {
  const pendingOps = offlineStorage.getPendingOperations();
  
  if (pendingOps.length === 0) {
    return;
  }
  
  updateSyncStatus('syncing');
  console.log(`Processing ${pendingOps.length} pending operations`);
  
  for (const op of pendingOps) {
    try {
      switch (op.type) {
        case 'create':
        case 'update':
          await electricClient.writeTodo(op.data);
          break;
        case 'delete':
          await electricClient.writeTodo({
            id: op.todoId,
            _deleted: true
          });
          break;
      }
      
      // Clear the operation after successful sync
      offlineStorage.clearPendingOperation(op.todoId, op.type);
    } catch (error) {
      console.error(`Failed to process pending operation for todo ${op.todoId}:`, error);
    }
  }
  
  updateSyncStatus('online');
}

// Function to sync with Supabase via ElectricSQL
async function syncWithSupabase() {
  try {
    updateSyncStatus('syncing');
    console.log('[syncWithSupabase] Starting sync');
    
    // Get todos from ElectricSQL - this now returns an array (empty if error)
    const remoteTodos = await electricClient.syncTodos();
    
    // Check if any todos were returned
    if (remoteTodos && remoteTodos.length > 0) {
      console.log(`[syncWithSupabase] Processing ${remoteTodos.length} todos`);
      
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO todos (id, title, completed, created_at)
        VALUES (?, ?, ?, ?)
      `);
      
      remoteTodos.forEach(todo => {
        try {
          stmt.run(
            todo.id,
            todo.title || '',
            todo.completed ? 1 : 0,
            todo.created_at || new Date().toISOString()
          );
        } catch (dbError) {
          console.error(`[syncWithSupabase] Error inserting todo ${todo.id}:`, dbError);
        }
      });
      
      console.log('[syncWithSupabase] Sync completed successfully');
    } else {
      console.log('[syncWithSupabase] No todos to process or sync failed');
    }
    
    // Update status based on connection status
    const isConnected = electricClient.isConnected();
    updateSyncStatus(isConnected ? 'online' : 'offline');
    
    return remoteTodos;
  } catch (error) {
    console.error('[syncWithSupabase] Sync error:', error);
    
    // Update status based on connection status
    updateSyncStatus(electricClient.isConnected() ? 'online' : 'offline');
    return [];
  }
}

// Update sync status and notify renderer
function updateSyncStatus(status: string) {
  syncStatus = status;
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    mainWindow.webContents.send('sync-status-change', status);
  }
}

// Create the browser window
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the index.html
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Initialize app
app.whenReady().then(() => {
  initDatabase();
  createWindow();
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on quit
app.on('quit', () => {
  if (onlineCheckInterval) {
    clearInterval(onlineCheckInterval);
  }
  
  if (electricClient) {
    electricClient.dispose();
  }
  
  if (db) {
    db.close();
  }
});

// IPC handlers for todo operations
ipcMain.handle('todos:getAll', async () => {
  try {
    // Try to sync first if online
    if (electricClient && electricClient.isConnected()) {
      await syncWithSupabase();
    }
    
    const stmt = db.prepare('SELECT * FROM todos ORDER BY created_at DESC');
    return stmt.all();
  } catch (error) {
    console.error('Error getting todos:', error);
    return [];
  }
});

ipcMain.handle('todos:add', async (_, title: string) => {
  try {
    // Generate UUID for the new todo
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    
    // Insert into local database
    const stmt = db.prepare('INSERT INTO todos (id, title, completed, created_at) VALUES (?, ?, ?, ?)');
    stmt.run(id, title, 0, created_at);
    
    const newTodo = { id, title, completed: 0, created_at };
    
    // Sync with Supabase if online
    if (electricClient && electricClient.isConnected()) {
      try {
        await electricClient.writeTodo({
          id,
          title,
          completed: false,
          created_at
        });
      } catch (syncError) {
        console.error('Error syncing new todo:', syncError);
        
        // Store as pending operation
        offlineStorage.addPendingOperation('create', id, {
          id,
          title,
          completed: false,
          created_at
        });
      }
    } else {
      // Store as pending operation if offline
      offlineStorage.addPendingOperation('create', id, {
        id,
        title,
        completed: false,
        created_at
      });
    }
    
    return newTodo;
  } catch (error) {
    console.error('Error adding todo:', error);
    return null;
  }
});

ipcMain.handle('todos:toggle', async (_, id: string, completed: boolean) => {
  try {
    // Update local database
    const stmt = db.prepare('UPDATE todos SET completed = ? WHERE id = ?');
    stmt.run(completed ? 1 : 0, id);
    
    // Get the updated todo
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    
    // Sync with Supabase if online
    if (electricClient && electricClient.isConnected()) {
      try {
        await electricClient.writeTodo({
          id,
          title: todo.title,
          completed,
          created_at: todo.created_at
        });
      } catch (syncError) {
        console.error('Error syncing todo update:', syncError);
        
        // Store as pending operation
        offlineStorage.addPendingOperation('update', id, {
          id,
          title: todo.title,
          completed,
          created_at: todo.created_at
        });
      }
    } else {
      // Store as pending operation if offline
      offlineStorage.addPendingOperation('update', id, {
        id,
        title: todo.title,
        completed,
        created_at: todo.created_at
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error toggling todo:', error);
    return false;
  }
});

ipcMain.handle('todos:delete', async (_, id: string) => {
  try {
    // Get the todo before deleting (for pending operations)
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    
    // Delete from local database
    const stmt = db.prepare('DELETE FROM todos WHERE id = ?');
    stmt.run(id);
    
    // Sync with Supabase if online
    if (electricClient && electricClient.isConnected()) {
      try {
        await electricClient.writeTodo({
          id,
          _deleted: true
        });
      } catch (syncError) {
        console.error('Error syncing todo deletion:', syncError);
        
        // Store as pending operation
        offlineStorage.addPendingOperation('delete', id, {
          id,
          _deleted: true
        });
      }
    } else {
      // Store as pending operation if offline
      offlineStorage.addPendingOperation('delete', id, {
        id,
        _deleted: true
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting todo:', error);
    return false;
  }
});

// IPC handlers for sync operations
ipcMain.handle('sync:status', () => {
  return syncStatus;
});

ipcMain.handle('sync:force', async () => {
  if (electricClient) {
    try {
      // Check connection first
      const isOnline = await electricClient.checkConnection();
      
      if (isOnline) {
        // Process any pending operations first
        await processPendingOperations();
        
        // Then sync with Supabase
        return await syncWithSupabase();
      } else {
        return { error: 'Not connected to Electric service' };
      }
    } catch (error) {
      console.error('Force sync error:', error);
      return { error: error.message };
    }
  }
  return { error: 'ElectricSQL client not initialized' };
});

// No need for the declaration since checkConnection is now public
