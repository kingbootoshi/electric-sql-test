import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Todo operations
  getTodos: () => ipcRenderer.invoke('todos:getAll'),
  addTodo: (title: string) => ipcRenderer.invoke('todos:add', title),
  toggleTodo: (id: string, completed: boolean) => ipcRenderer.invoke('todos:toggle', id, completed),
  deleteTodo: (id: string) => ipcRenderer.invoke('todos:delete', id),
  
  // Sync operations
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  forceSync: () => ipcRenderer.invoke('sync:force'),
  
  // Sync status listener
  onSyncStatusChange: (callback: (status: string) => void) => {
    ipcRenderer.on('sync-status-change', (_event, status) => callback(status));
    return () => {
      ipcRenderer.removeAllListeners('sync-status-change');
    };
  }
});
