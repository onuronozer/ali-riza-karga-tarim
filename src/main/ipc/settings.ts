import { ipcMain } from 'electron';
import type { FirebaseSettings, SaveDeviceInput } from '../../shared/ipc-contracts/app-api';
import { getCurrentDevice, saveDevice } from '../services/deviceService';
import { getFirebaseSettings, saveFirebaseSettings } from '../services/firebaseSettingsService';

export function registerSettingsIpcHandlers(): void {
  ipcMain.handle('settings:get-device', () => getCurrentDevice());

  ipcMain.handle('settings:save-device', (_event, input: SaveDeviceInput) => {
    return saveDevice(input);
  });

  ipcMain.handle('settings:get-firebase-settings', () => getFirebaseSettings());

  ipcMain.handle('settings:save-firebase-settings', (_event, input: FirebaseSettings) => {
    return saveFirebaseSettings(input);
  });
}
