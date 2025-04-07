/**
 * IPC Channels
 * Defines all IPC channel names used in the application
 */

/**
 * Todo-related channels
 */
export const TODO_CHANNELS = {
  GET_ALL: 'todos:getAll',
  ADD: 'todos:add',
  TOGGLE: 'todos:toggle',
  DELETE: 'todos:delete'
};

/**
 * Sync-related channels
 */
export const SYNC_CHANNELS = {
  GET_STATUS: 'sync:status',
  FORCE_SYNC: 'sync:force'
};

/**
 * Events (main to renderer)
 */
export const EVENTS = {
  SYNC_STATUS_CHANGE: 'sync-status-change',
  TODOS_UPDATED: 'todos-updated',
  APP_ERROR: 'app-error'
};

/**
 * All channels (for registration/unregistration)
 */
export const ALL_CHANNELS = {
  ...TODO_CHANNELS,
  ...SYNC_CHANNELS
};

/**
 * All events (for registration/unregistration)
 */
export const ALL_EVENTS = {
  ...EVENTS
};