import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import { ElectricClient } from './electric-client';
import { OfflineStorageManager } from './offline-storage';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Todo } from '../@types/todo';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize database
let db: Database.Database;
let electricClient: ElectricClient;
let offlineStorage: OfflineStorageManager;
let syncStatus = 'offline';
let onlineCheckInterval: NodeJS.Timeout | null = null;
// Use module-level variable instead of global
let lastSyncTime: number = Date.now();

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
  let consecutiveElectricFailures = 0;
  let consecutiveSupabaseFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  
  onlineCheckInterval = setInterval(async () => {
    console.log('[startOnlineStatusCheck] Checking connection status');
    
    // Check connections to both services
    const isNowElectricOnline = await electricClient.checkConnection();
    
    // Update electric client's internal state
    electricClient.setConnectionStatus(isNowElectricOnline);
    
    // Check Supabase connection
    let isSupabaseOnline = false;
    try {
      const { error: pingError } = await supabase.from('todos').select('id', { count: 'exact', head: true });
      isSupabaseOnline = !pingError;
      
      if (pingError) {
        console.error('[startOnlineStatusCheck] Supabase connection check failed:', pingError);
        consecutiveSupabaseFailures++;
      } else {
        consecutiveSupabaseFailures = 0;
      }
    } catch (err) {
      console.error('[startOnlineStatusCheck] Supabase connection check error:', err);
      consecutiveSupabaseFailures++;
    }
    
    // Track Electric failures
    if (!isNowElectricOnline) {
      consecutiveElectricFailures++;
      console.log(`[startOnlineStatusCheck] Electric connection check failed (${consecutiveElectricFailures}/${MAX_CONSECUTIVE_FAILURES})`);
    } else {
      consecutiveElectricFailures = 0;
    }
    
    // Consider the overall app online if either service is available
    // For sync to work fully, we need Electric. For writes, we need Supabase.
    // But having either one allows some functionality
    const wasAppOnline = syncStatus === 'online';
    const isAppOffline = (consecutiveElectricFailures >= MAX_CONSECUTIVE_FAILURES && 
                          consecutiveSupabaseFailures >= MAX_CONSECUTIVE_FAILURES);
    
    // If app was offline but now either service is reliably online
    if (syncStatus === 'offline' && !isAppOffline) {
      console.log('[startOnlineStatusCheck] Connection restored, syncing pending operations...');
      updateSyncStatus('online');
      
      try {
        // Only process pending operations if Supabase is online
        if (isSupabaseOnline && consecutiveSupabaseFailures === 0) {
          await processPendingOperations();
        }
        
        // Only sync if Electric is online
        if (isNowElectricOnline && consecutiveElectricFailures === 0) {
          await syncWithSupabase();
        }
      } catch (error) {
        console.error('[startOnlineStatusCheck] Error processing operations or syncing:', error);
        
        // Recheck connection status for UI
        updateSyncStatus(isAppOffline ? 'offline' : 'online');
      }
    } 
    // If status changed from online to offline
    else if (wasAppOnline && isAppOffline) {
      console.log('[startOnlineStatusCheck] Connection lost to both services, switching to offline mode');
      updateSyncStatus('offline');
    } 
    // If staying online, potentially do periodic sync with Electric
    else if (!isAppOffline && isNowElectricOnline && consecutiveElectricFailures === 0) {
      // Periodically sync when stable and Electric is available (every 5th check ~ 50 seconds)
      const currentTime = Date.now();
      const SYNC_INTERVAL = 50000; // 50 seconds between forced syncs
      
      if (!lastSyncTime || (currentTime - lastSyncTime) > SYNC_INTERVAL) {
        try {
          await syncWithSupabase();
          lastSyncTime = currentTime;
        } catch (error) {
          console.error('[startOnlineStatusCheck] Periodic sync error:', error);
        }
      }
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
  console.log(`[processPendingOperations] Processing ${pendingOps.length} pending operations`);
  
  // Verify Supabase connection by making a small request
  try {
    const { error: pingError } = await supabase.from('todos').select('id', { count: 'exact', head: true });
    if (pingError) {
      console.error('[processPendingOperations] Supabase connection check failed:', pingError);
      updateSyncStatus('offline');
      return;
    }
  } catch (pingError) {
    console.error('[processPendingOperations] Supabase connection check threw exception:', pingError);
    updateSyncStatus('offline');
    return;
  }
  
  let succeededCount = 0;
  let failedCount = 0;
  
  for (const op of pendingOps) {
    try {
      let result;
      
      switch (op.type) {
        case 'create':
          console.log(`[processPendingOperations] Inserting todo ${op.todoId} into Supabase`);
          result = await supabase.from('todos').insert({
            id: op.data.id,
            title: op.data.title,
            completed: op.data.completed === true || op.data.completed === 1,
            created_at: op.data.created_at
          });
          break;
        
        case 'update':
          console.log(`[processPendingOperations] Updating todo ${op.todoId} in Supabase`);
          result = await supabase.from('todos').update({
            title: op.data.title,
            completed: op.data.completed === true || op.data.completed === 1,
          }).eq('id', op.todoId);
          break;
        
        case 'delete':
          console.log(`[processPendingOperations] Deleting todo ${op.todoId} from Supabase`);
          result = await supabase.from('todos').delete().eq('id', op.todoId);
          break;
      }
      
      if (result?.error) {
        console.error(`[processPendingOperations] Supabase error for ${op.type} operation on todo ${op.todoId}:`, result.error);
        failedCount++;
      } else {
        // Clear the operation after successful sync
        offlineStorage.clearPendingOperation(op.todoId, op.type);
        succeededCount++;
      }
    } catch (error) {
      console.error(`[processPendingOperations] Failed to process pending operation for todo ${op.todoId}:`, error);
      failedCount++;
    }
  }
  
  console.log(`[processPendingOperations] Completed: ${succeededCount} succeeded, ${failedCount} failed`);
  updateSyncStatus('online');
}

// Function to sync with Supabase via ElectricSQL
async function syncWithSupabase() {
  try {
    updateSyncStatus('syncing');
    console.log('[syncWithSupabase] Starting sync from Supabase via Electric');

    // Get processed entries (which now have { operation, id, value })
    const processedEntries = await electricClient.syncTodos();

    if (processedEntries && processedEntries.length > 0) {
      console.log(`[syncWithSupabase] Processing ${processedEntries.length} synced changes`);

      let inserted = 0;
      let updated = 0;
      let deleted = 0;

      // Prepare statements outside the loop for efficiency
      const insertStmt = db.prepare(`INSERT OR REPLACE INTO todos (id, title, completed, created_at) VALUES (?, ?, ?, ?)`);
      const deleteStmt = db.prepare(`DELETE FROM todos WHERE id = ?`);
      // Update needs dynamic construction based on fields to update

      db.transaction(() => { // Use transaction for atomicity
        processedEntries.forEach(entry => {
          try {
            switch (entry.operation) {
              case 'insert':
                if (entry.value) {
                  insertStmt.run(
                    entry.id,
                    entry.value.title || '',
                    entry.value.completed === 'true' || entry.value.completed === true ? 1 : 0,
                    entry.value.created_at || new Date().toISOString()
                  );
                  inserted++;
                } else {
                  console.warn(`[syncWithSupabase] Skipping insert for ${entry.id} due to missing value`);
                }
                break;

              case 'update':
                if (entry.value) {
                  // Build SET clause dynamically based on available fields
                  const updates: string[] = [];
                  const params: any[] = [];
                  
                  if (entry.value.hasOwnProperty('title')) {
                    updates.push('title = ?');
                    params.push(entry.value.title);
                  }
                  
                  if (entry.value.hasOwnProperty('completed')) {
                    updates.push('completed = ?');
                    params.push(entry.value.completed === 'true' || entry.value.completed === true ? 1 : 0);
                  }
                  
                  if (entry.value.hasOwnProperty('created_at')) {
                    updates.push('created_at = ?');
                    params.push(entry.value.created_at);
                  }

                  if (updates.length > 0) {
                    params.push(entry.id); // Add id for WHERE clause
                    const sql = `UPDATE todos SET ${updates.join(', ')} WHERE id = ?`;
                    const updateStmt = db.prepare(sql);
                    const info = updateStmt.run(...params);
                    if (info.changes > 0) updated++;
                    else console.warn(`[syncWithSupabase] Update for ${entry.id} affected 0 rows.`);
                  } else {
                    console.warn(`[syncWithSupabase] Skipping update for ${entry.id}, no fields in value.`);
                  }
                } else {
                  console.warn(`[syncWithSupabase] Skipping update for ${entry.id} due to missing value`);
                }
                break;

              case 'delete':
                const info = deleteStmt.run(entry.id);
                if (info.changes > 0) deleted++;
                else console.warn(`[syncWithSupabase] Delete for ${entry.id} affected 0 rows (may have been deleted already).`);
                break;
            }
          } catch (dbError) {
            console.error(`[syncWithSupabase] Error applying ${entry.operation} for todo ${entry.id}:`, dbError);
          }
        });
      })(); // End transaction

      console.log(`[syncWithSupabase] Sync applied: ${inserted} inserted/replaced, ${updated} updated, ${deleted} deleted.`);

      // Notify renderer that data changed if any changes were applied
      if (inserted > 0 || updated > 0 || deleted > 0) {
        notifyRendererDataChanged();
      }
    } else {
      console.log('[syncWithSupabase] Sync successful but no new data changes to process');
    }

    const isConnected = electricClient.isConnected();
    updateSyncStatus(isConnected ? 'online' : 'offline');
    return processedEntries;

  } catch (error) {
    console.error('[syncWithSupabase] Sync error:', error);
    
    // Check if the error is a network error or a specific API error
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.log('[syncWithSupabase] Network error detected during sync');
    } else {
      console.log('[syncWithSupabase] API error during sync, but not marking as offline');
    }
    
    // Update status based on connection status (which may have changed in syncTodos)
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

// Notify renderer that data has changed (needs UI refresh)
function notifyRendererDataChanged() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    mainWindow.webContents.send('todos-updated');
    console.log('[notifyRendererDataChanged] Notified renderer of data changes');
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
    
    // Check if we're online by testing Supabase connection
    let isOnline = false;
    try {
      const { error: pingError } = await supabase.from('todos').select('id', { count: 'exact', head: true });
      isOnline = !pingError;
    } catch (err) {
      console.error('[todos:add] Supabase connection check error:', err);
      isOnline = false;
    }
    
    // Sync with Supabase if online
    if (isOnline) {
      try {
        console.log('[todos:add] Adding todo directly to Supabase:', id);
        const { error: supabaseError } = await supabase.from('todos').insert({
          id,
          title,
          completed: false,
          created_at
        });
        
        if (supabaseError) {
          console.error('[todos:add] Supabase insert error:', supabaseError);
          
          // Store as pending operation
          offlineStorage.addPendingOperation('create', id, {
            id,
            title,
            completed: false,
            created_at
          });
        } else {
          console.log('[todos:add] Todo added to Supabase successfully:', id);
        }
      } catch (syncError) {
        console.error('[todos:add] Error adding to Supabase:', syncError);
        
        // Store as pending operation
        offlineStorage.addPendingOperation('create', id, {
          id,
          title,
          completed: false,
          created_at
        });
      }
    } else {
      console.log('[todos:add] Offline, storing pending operation');
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
    console.error('[todos:add] Error adding todo:', error);
    return null;
  }
});

ipcMain.handle('todos:toggle', async (_, id: string, completed: boolean) => {
  try {
    // Update local database
    const stmt = db.prepare('UPDATE todos SET completed = ? WHERE id = ?');
    stmt.run(completed ? 1 : 0, id);
    
    // Get the updated todo and cast to the defined interface
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo;
    
    // Check if the todo was actually found
    if (!todo) {
      console.error(`[todos:toggle] Todo with id ${id} not found after update.`);
      return false; // Indicate failure
    }

    // Check if we're online by testing Supabase connection
    let isOnline = false;
    try {
      const { error: pingError } = await supabase.from('todos').select('id', { count: 'exact', head: true });
      isOnline = !pingError;
    } catch (err) {
      console.error('[todos:toggle] Supabase connection check error:', err);
      isOnline = false;
    }
    
    // Sync with Supabase if online
    if (isOnline) {
      try {
        console.log(`[todos:toggle] Updating todo ${id} directly in Supabase: completed=${completed}`);
        const { error: supabaseError } = await supabase.from('todos').update({
          completed: completed
        }).eq('id', id);
        
        if (supabaseError) {
          console.error('[todos:toggle] Supabase update error:', supabaseError);
          
          // Store as pending operation
          offlineStorage.addPendingOperation('update', id, {
            id,
            title: todo.title,
            completed,
            created_at: todo.created_at
          });
        } else {
          console.log(`[todos:toggle] Todo ${id} updated in Supabase successfully`);
        }
      } catch (syncError) {
        console.error('[todos:toggle] Error updating in Supabase:', syncError);
        
        // Store as pending operation
        offlineStorage.addPendingOperation('update', id, {
          id,
          title: todo.title,
          completed,
          created_at: todo.created_at
        });
      }
    } else {
      console.log('[todos:toggle] Offline, storing pending operation');
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
    console.error('[todos:toggle] Error toggling todo:', error);
    return false;
  }
});

ipcMain.handle('todos:delete', async (_, id: string) => {
  try {    
    // Delete from local database
    const stmt = db.prepare('DELETE FROM todos WHERE id = ?');
    stmt.run(id);
    
    // Check if we're online by testing Supabase connection
    let isOnline = false;
    try {
      const { error: pingError } = await supabase.from('todos').select('id', { count: 'exact', head: true });
      isOnline = !pingError;
    } catch (err) {
      console.error('[todos:delete] Supabase connection check error:', err);
      isOnline = false;
    }
    
    // Sync with Supabase if online
    if (isOnline) {
      try {
        console.log(`[todos:delete] Deleting todo ${id} directly from Supabase`);
        const { error: supabaseError } = await supabase.from('todos').delete().eq('id', id);
        
        if (supabaseError) {
          console.error('[todos:delete] Supabase delete error:', supabaseError);
          
          // Store as pending operation
          offlineStorage.addPendingOperation('delete', id);
        } else {
          console.log(`[todos:delete] Todo ${id} deleted from Supabase successfully`);
        }
      } catch (syncError) {
        console.error('[todos:delete] Error deleting from Supabase:', syncError);
        
        // Store as pending operation
        offlineStorage.addPendingOperation('delete', id);
      }
    } else {
      console.log('[todos:delete] Offline, storing pending operation');
      // Store as pending operation if offline
      offlineStorage.addPendingOperation('delete', id);
    }
    
    return true;
  } catch (error) {
    console.error('[todos:delete] Error deleting todo:', error);
    return false;
  }
});

// IPC handlers for sync operations
ipcMain.handle('sync:status', () => {
  return syncStatus;
});

ipcMain.handle('sync:force', async () => {
  try {
    // Check both Electric and Supabase connections
    const isElectricOnline = await electricClient.checkConnection();
    electricClient.setConnectionStatus(isElectricOnline);
    
    let isSupabaseOnline = false;
    try {
      const { error: pingError } = await supabase.from('todos').select('id', { count: 'exact', head: true });
      isSupabaseOnline = !pingError;
    } catch (err) {
      console.error('[sync:force] Supabase connection check error:', err);
      isSupabaseOnline = false;
    }
    
    const results: any = {
      electric: isElectricOnline ? 'connected' : 'disconnected',
      supabase: isSupabaseOnline ? 'connected' : 'disconnected',
      operations: { processed: 0, pending: 0 },
      sync: { received: 0, processed: 0, inserts: 0, updates: 0, deletes: 0 }
    };
    
    // Update UI status based on combined status
    updateSyncStatus((isElectricOnline || isSupabaseOnline) ? 'online' : 'offline');
    
    // Process pending operations if Supabase is available
    if (isSupabaseOnline) {
      console.log('[sync:force] Processing pending operations...');
      
      // Process any pending operations first
      const pendingOps = offlineStorage.getPendingOperations();
      results.operations.pending = pendingOps.length;
      
      if (pendingOps.length > 0) {
        await processPendingOperations();
        // Count how many are left to determine success
        const remainingOps = offlineStorage.getPendingOperations();
        results.operations.processed = pendingOps.length - remainingOps.length;
      }
    }
    
    // Then sync with Supabase if Electric is available
    if (isElectricOnline) {
      console.log('[sync:force] Syncing with Supabase via Electric...');
      const syncResult = await syncWithSupabase();
      results.sync.received = syncResult.length;
      
      // Count operations by type
      const operationCounts = syncResult.reduce((acc, entry) => {
        acc[entry.operation] = (acc[entry.operation] || 0) + 1;
        return acc;
      }, { insert: 0, update: 0, delete: 0 });
      
      results.sync.inserts = operationCounts.insert;
      results.sync.updates = operationCounts.update;
      results.sync.deletes = operationCounts.delete;
      
      // Set the module-level variable last sync time
      lastSyncTime = Date.now();
    }
    
    return results;
  } catch (error: any) {
    console.error('[sync:force] Force sync error:', error);
    return { 
      error: error.message,
      electric: electricClient.isConnected() ? 'connected' : 'disconnected'
    };
  }
});

// No need for the declaration since checkConnection is now public
