/**
 * Preload script
 * Exposes a minimal API to the renderer process via contextBridge
 */
import { contextBridge, ipcRenderer } from 'electron';
import { 
  TODO_CHANNELS, 
  SYNC_CHANNELS, 
  EVENTS 
} from '../main/ipc/channels';

// Type definitions for the exposed API
interface TodoAPI {
  getTodos: () => Promise<any[]>;
  addTodo: (title: string) => Promise<any>;
  toggleTodo: (id: string, completed: boolean) => Promise<boolean>;
  deleteTodo: (id: string) => Promise<boolean>;
}

interface SyncAPI {
  getSyncStatus: () => Promise<string>;
  forceSync: () => Promise<any>;
}

interface EventsAPI {
  onSyncStatusChange: (callback: (status: string) => void) => () => void;
  onTodosUpdated: (callback: () => void) => () => void;
  onAppError: (callback: (error: any) => void) => () => void;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Todo operations
  getTodos: () => ipcRenderer.invoke(TODO_CHANNELS.GET_ALL),
  addTodo: (title: string) => ipcRenderer.invoke(TODO_CHANNELS.ADD, title),
  toggleTodo: (id: string, completed: boolean) => ipcRenderer.invoke(TODO_CHANNELS.TOGGLE, id, completed),
  deleteTodo: (id: string) => ipcRenderer.invoke(TODO_CHANNELS.DELETE, id),
  
  // Sync operations
  getSyncStatus: () => ipcRenderer.invoke(SYNC_CHANNELS.GET_STATUS),
  forceSync: () => ipcRenderer.invoke(SYNC_CHANNELS.FORCE_SYNC),
  
  // Event listeners
  onSyncStatusChange: (callback: (status: string) => void) => {
    ipcRenderer.on(EVENTS.SYNC_STATUS_CHANGE, (_event, status) => callback(status));
    return () => {
      ipcRenderer.removeAllListeners(EVENTS.SYNC_STATUS_CHANGE);
    };
  },
  
  onTodosUpdated: (callback: () => void) => {
    ipcRenderer.on(EVENTS.TODOS_UPDATED, () => callback());
    return () => {
      ipcRenderer.removeAllListeners(EVENTS.TODOS_UPDATED);
    };
  },
  
  onAppError: (callback: (error: any) => void) => {
    ipcRenderer.on(EVENTS.APP_ERROR, (_event, error) => callback(error));
    return () => {
      ipcRenderer.removeAllListeners(EVENTS.APP_ERROR);
    };
  }
} as TodoAPI & SyncAPI & EventsAPI);