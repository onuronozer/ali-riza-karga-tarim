import { hostname } from 'node:os';
import type { DeviceInfo, SaveDeviceInput } from '../../shared/ipc-contracts/app-api';
import { findDeviceById, upsertDevice } from '../repositories/devicesRepository';
import { getSettings, setSetting } from '../repositories/settingsRepository';

const DEVICE_CODE_PATTERN = /^[A-Z0-9_-]{2,16}$/;

function normalizeDeviceCode(deviceCode: string): string {
  return deviceCode.trim().toUpperCase();
}

function normalizeDeviceName(deviceName: string | undefined): string {
  const normalized = deviceName?.trim();
  return normalized && normalized.length > 0 ? normalized : hostname();
}

export function getCurrentDevice(): DeviceInfo {
  const settings = getSettings(['device_id', 'device_code', 'device_name']);
  const settingDeviceId = settings.device_id;
  const device = settingDeviceId ? findDeviceById(settingDeviceId) : null;

  if (device) {
    return {
      id: device.id,
      deviceCode: device.device_code,
      deviceName: device.device_name,
      isConfigured: true,
      updatedAt: device.updated_at
    };
  }

  return {
    id: null,
    deviceCode: settings.device_code,
    deviceName: settings.device_name,
    isConfigured: Boolean(settings.device_code),
    updatedAt: null
  };
}

export function saveDevice(input: SaveDeviceInput): DeviceInfo {
  const deviceCode = normalizeDeviceCode(input.deviceCode);

  if (!DEVICE_CODE_PATTERN.test(deviceCode)) {
    throw new Error('Cihaz kodu 2-16 karakter olmalı; harf, rakam, tire veya alt çizgi kullanın.');
  }

  const deviceName = normalizeDeviceName(input.deviceName);
  const device = upsertDevice(deviceCode, deviceName);

  setSetting('device_id', device.id);
  setSetting('device_code', device.device_code);
  setSetting('device_name', device.device_name);

  return {
    id: device.id,
    deviceCode: device.device_code,
    deviceName: device.device_name,
    isConfigured: true,
    updatedAt: device.updated_at
  };
}
