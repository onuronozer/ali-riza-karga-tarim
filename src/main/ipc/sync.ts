import { ipcMain } from 'electron';
import { getSyncStatus, runFirestoreSync } from '../services/syncService';

export function registerSyncIpcHandlers(): void {
  ipcMain.handle('sync:get-status', () => getSyncStatus());
  ipcMain.handle('sync:run-now', () => runFirestoreSync());
}
