import type { MaintenanceResetInput, MaintenanceResetResult } from '../../shared/ipc-contracts/app-api';
import { getDatabase } from '../db/connection';
import { setSetting } from '../repositories/settingsRepository';
import { clearFirestoreDataForReset } from './syncService';

const LOCAL_RESET_TABLES = [
  'sync_logs',
  'daily_company_summaries',
  'daily_type_summaries',
  'season_summaries',
  'receipt_number_counters',
  'farmer_payments',
  'company_payments',
  'purchase_receipts',
  'apricot_types',
  'farmers',
  'companies',
  'seasons'
] as const;

const RESET_PASSWORD = 'KARGA2026';
const RESET_CONFIRMATION = 'SIFIRLA';

function assertResetAuthorized(input: MaintenanceResetInput): void {
  const confirmation = input?.confirmation?.trim().toUpperCase();

  if (input?.password !== RESET_PASSWORD || confirmation !== RESET_CONFIRMATION) {
    throw new Error('Sıfırlama şifresi veya onay metni hatalı.');
  }
}

function clearLocalData(): number {
  const db = getDatabase();
  let deletedCount = 0;

  const reset = db.transaction(() => {
    for (const tableName of LOCAL_RESET_TABLES) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
      deletedCount += row.count;
      db.prepare(`DELETE FROM ${tableName}`).run();
    }

    setSetting('last_sync_at', null);
  });

  reset();
  return deletedCount;
}

export async function resetTestData(input: MaintenanceResetInput): Promise<MaintenanceResetResult> {
  assertResetAuthorized(input);

  const firebaseResult = await clearFirestoreDataForReset();
  const localDeletedCount = clearLocalData();

  return {
    localDeletedCount,
    firebaseDeletedCount: firebaseResult.deletedCount,
    firebaseSkipped: firebaseResult.skipped
  };
}
