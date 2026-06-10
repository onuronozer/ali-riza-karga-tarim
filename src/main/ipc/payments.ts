import { ipcMain } from 'electron';
import type {
  CancelInput,
  SaveCompanyPaymentInput,
  SaveFarmerPaymentInput
} from '../../shared/ipc-contracts/app-api';
import {
  cancelCompanyPayment,
  cancelFarmerPayment,
  createCompanyPayment,
  createFarmerPayment,
  listCompanyPayments,
  listFarmerPayments
} from '../services/paymentService';

export function registerPaymentIpcHandlers(): void {
  ipcMain.handle('farmer-payments:list', () => listFarmerPayments());
  ipcMain.handle('farmer-payments:create', (_event, input: SaveFarmerPaymentInput) => createFarmerPayment(input));
  ipcMain.handle('farmer-payments:cancel', (_event, input: CancelInput) => cancelFarmerPayment(input));

  ipcMain.handle('company-payments:list', () => listCompanyPayments());
  ipcMain.handle('company-payments:create', (_event, input: SaveCompanyPaymentInput) => createCompanyPayment(input));
  ipcMain.handle('company-payments:cancel', (_event, input: CancelInput) => cancelCompanyPayment(input));
}
