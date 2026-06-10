import { ipcMain } from 'electron';
import type { CancelInput, SavePurchaseReceiptInput } from '../../shared/ipc-contracts/app-api';
import { cancelPurchaseReceipt, createPurchaseReceipt, listPurchaseReceipts } from '../services/purchaseService';

export function registerPurchaseIpcHandlers(): void {
  ipcMain.handle('purchases:list', () => listPurchaseReceipts());
  ipcMain.handle('purchases:create', (_event, input: SavePurchaseReceiptInput) => createPurchaseReceipt(input));
  ipcMain.handle('purchases:cancel', (_event, input: CancelInput) => cancelPurchaseReceipt(input));
}
