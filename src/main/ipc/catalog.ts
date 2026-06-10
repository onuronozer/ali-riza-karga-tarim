import { ipcMain } from 'electron';
import type {
  SaveApricotTypeInput,
  SaveCompanyInput,
  SaveFarmerInput,
  SaveSeasonInput
} from '../../shared/ipc-contracts/app-api';
import {
  deactivateApricotType,
  deactivateCompany,
  deactivateFarmer,
  getActiveSeason,
  getDashboardOverview,
  listApricotTypes,
  listCompanies,
  listFarmers,
  listSeasons,
  saveApricotType,
  saveCompany,
  saveFarmer,
  saveSeason,
  setActiveSeason
} from '../services/catalogService';

export function registerCatalogIpcHandlers(): void {
  ipcMain.handle('seasons:list', () => listSeasons());
  ipcMain.handle('seasons:get-active', () => getActiveSeason());
  ipcMain.handle('seasons:save', (_event, input: SaveSeasonInput) => saveSeason(input));
  ipcMain.handle('seasons:set-active', (_event, id: string) => setActiveSeason(id));

  ipcMain.handle('farmers:list', (_event, search?: string) => listFarmers(search));
  ipcMain.handle('farmers:save', (_event, input: SaveFarmerInput) => saveFarmer(input));
  ipcMain.handle('farmers:deactivate', (_event, id: string) => deactivateFarmer(id));

  ipcMain.handle('companies:list', (_event, search?: string) => listCompanies(search));
  ipcMain.handle('companies:save', (_event, input: SaveCompanyInput) => saveCompany(input));
  ipcMain.handle('companies:deactivate', (_event, id: string) => deactivateCompany(id));

  ipcMain.handle('apricot-types:list', () => listApricotTypes());
  ipcMain.handle('apricot-types:save', (_event, input: SaveApricotTypeInput) => saveApricotType(input));
  ipcMain.handle('apricot-types:deactivate', (_event, id: string) => deactivateApricotType(id));

  ipcMain.handle('dashboard:get-overview', () => getDashboardOverview());
}
