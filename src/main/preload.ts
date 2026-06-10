import { contextBridge, ipcRenderer } from 'electron';
import type { AppApi, FirebaseSettings, SaveDeviceInput } from '../shared/ipc-contracts/app-api';

const api: AppApi = {
  system: {
    ping: () => ipcRenderer.invoke('system:ping')
  },
  settings: {
    getDevice: () => ipcRenderer.invoke('settings:get-device'),
    saveDevice: (input: SaveDeviceInput) => ipcRenderer.invoke('settings:save-device', input),
    getFirebaseSettings: () => ipcRenderer.invoke('settings:get-firebase-settings'),
    saveFirebaseSettings: (input: FirebaseSettings) => ipcRenderer.invoke('settings:save-firebase-settings', input)
  },
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:get-status'),
    runNow: () => ipcRenderer.invoke('sync:run-now')
  },
  seasons: {
    list: () => ipcRenderer.invoke('seasons:list'),
    getActive: () => ipcRenderer.invoke('seasons:get-active'),
    save: (input) => ipcRenderer.invoke('seasons:save', input),
    setActive: (id) => ipcRenderer.invoke('seasons:set-active', id)
  },
  farmers: {
    list: (search) => ipcRenderer.invoke('farmers:list', search),
    save: (input) => ipcRenderer.invoke('farmers:save', input),
    deactivate: (id) => ipcRenderer.invoke('farmers:deactivate', id)
  },
  companies: {
    list: (search) => ipcRenderer.invoke('companies:list', search),
    save: (input) => ipcRenderer.invoke('companies:save', input),
    deactivate: (id) => ipcRenderer.invoke('companies:deactivate', id)
  },
  apricotTypes: {
    list: () => ipcRenderer.invoke('apricot-types:list'),
    save: (input) => ipcRenderer.invoke('apricot-types:save', input),
    deactivate: (id) => ipcRenderer.invoke('apricot-types:deactivate', id)
  },
  dashboard: {
    getOverview: () => ipcRenderer.invoke('dashboard:get-overview')
  },
  purchases: {
    list: () => ipcRenderer.invoke('purchases:list'),
    create: (input) => ipcRenderer.invoke('purchases:create', input),
    cancel: (input) => ipcRenderer.invoke('purchases:cancel', input)
  },
  farmerPayments: {
    list: () => ipcRenderer.invoke('farmer-payments:list'),
    create: (input) => ipcRenderer.invoke('farmer-payments:create', input),
    cancel: (input) => ipcRenderer.invoke('farmer-payments:cancel', input)
  },
  companyPayments: {
    list: () => ipcRenderer.invoke('company-payments:list'),
    create: (input) => ipcRenderer.invoke('company-payments:create', input),
    cancel: (input) => ipcRenderer.invoke('company-payments:cancel', input)
  },
  reports: {
    getSnapshot: () => ipcRenderer.invoke('reports:get-snapshot')
  }
};

contextBridge.exposeInMainWorld('arkTarim', api);
