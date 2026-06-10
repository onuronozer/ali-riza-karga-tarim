/// <reference types="vite/client" />

import type { AppApi } from '../shared/ipc-contracts/app-api';

declare global {
  interface Window {
    arkTarim: AppApi;
  }
}

export {};
