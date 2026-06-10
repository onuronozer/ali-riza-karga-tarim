import { getDatabase } from '../db/connection';

interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

export function getSetting(key: string): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as Pick<SettingRow, 'value'> | undefined;

  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO settings (key, value, updated_at)
      VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      `
    )
    .run({
      key,
      value,
      updatedAt: new Date().toISOString()
    });
}

export function getSettings(keys: string[]): Record<string, string | null> {
  const settings: Record<string, string | null> = {};

  for (const key of keys) {
    settings[key] = getSetting(key);
  }

  return settings;
}
