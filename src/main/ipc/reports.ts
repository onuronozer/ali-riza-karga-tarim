import { ipcMain } from 'electron';
import { getReportsSnapshot } from '../services/reportService';

export function registerReportIpcHandlers(): void {
  ipcMain.handle('reports:get-snapshot', () => getReportsSnapshot());
}
