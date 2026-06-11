import { ipcMain } from 'electron';
import { registerCatalogIpcHandlers } from './catalog';
import { registerPaymentIpcHandlers } from './payments';
import { registerPurchaseIpcHandlers } from './purchases';
import { registerReportIpcHandlers } from './reports';
import { registerSettingsIpcHandlers } from './settings';
import { registerSyncIpcHandlers } from './sync';
import { registerMaintenanceIpcHandlers } from './maintenance';

export function registerIpcHandlers(): void {
  ipcMain.handle('system:ping', () => ({
    ok: true,
    appName: 'Ali Rıza Karga TARIM',
    version: '0.1.0'
  }));

  registerSettingsIpcHandlers();
  registerMaintenanceIpcHandlers();
  registerCatalogIpcHandlers();
  registerPurchaseIpcHandlers();
  registerPaymentIpcHandlers();
  registerReportIpcHandlers();
  registerSyncIpcHandlers();
}
