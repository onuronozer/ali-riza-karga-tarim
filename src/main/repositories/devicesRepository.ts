import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db/connection';

export interface DeviceRow {
  id: string;
  device_code: string;
  device_name: string | null;
  created_at: string;
  updated_at: string;
}

export function findDeviceByCode(deviceCode: string): DeviceRow | null {
  const row = getDatabase()
    .prepare('SELECT * FROM devices WHERE device_code = ?')
    .get(deviceCode) as DeviceRow | undefined;

  return row ?? null;
}

export function findDeviceById(id: string): DeviceRow | null {
  const row = getDatabase().prepare('SELECT * FROM devices WHERE id = ?').get(id) as
    | DeviceRow
    | undefined;

  return row ?? null;
}

export function upsertDevice(deviceCode: string, deviceName: string | null): DeviceRow {
  const existing = findDeviceByCode(deviceCode);
  const now = new Date().toISOString();

  if (existing) {
    getDatabase()
      .prepare(
        `
        UPDATE devices
        SET device_name = ?, updated_at = ?
        WHERE id = ?
        `
      )
      .run(deviceName, now, existing.id);

    return {
      ...existing,
      device_name: deviceName,
      updated_at: now
    };
  }

  const device: DeviceRow = {
    id: randomUUID(),
    device_code: deviceCode,
    device_name: deviceName,
    created_at: now,
    updated_at: now
  };

  getDatabase()
    .prepare(
      `
      INSERT INTO devices (id, device_code, device_name, created_at, updated_at)
      VALUES (@id, @device_code, @device_name, @created_at, @updated_at)
      `
    )
    .run(device);

  return device;
}
