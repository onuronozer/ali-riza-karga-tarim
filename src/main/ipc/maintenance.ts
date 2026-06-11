import { ipcMain } from 'electron';
import type { MaintenanceResetInput } from '../../shared/ipc-contracts/app-api';
import { resetTestData } from '../services/maintenanceService';

export function registerMaintenanceIpcHandlers(): void {
  ipcMain.handle('maintenance:reset-test-data', (_event, input: MaintenanceResetInput) => resetTestData(input));
}
