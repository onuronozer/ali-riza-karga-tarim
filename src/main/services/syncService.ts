import { randomUUID } from 'node:crypto';
import { deleteApp, getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, getFirestore, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import type { FirebaseSettings, SyncResult, SyncStatus } from '../../shared/ipc-contracts/app-api';
import { getDatabase } from '../db/connection';
import { getSetting, setSetting } from '../repositories/settingsRepository';
import { getFirebaseSettings, hasFirebaseSettings } from './firebaseSettingsService';

const APP_NAME = 'ark-tarim-sync';
const SYNC_TABLES = [
  { tableName: 'seasons', collectionName: 'seasons' },
  { tableName: 'farmers', collectionName: 'farmers' },
  { tableName: 'companies', collectionName: 'companies' },
  { tableName: 'apricot_types', collectionName: 'apricotTypes' },
  { tableName: 'purchase_receipts', collectionName: 'purchaseReceipts' },
  { tableName: 'farmer_payments', collectionName: 'farmerPayments' },
  { tableName: 'company_payments', collectionName: 'companyPayments' }
] as const;
const RESET_FIRESTORE_COLLECTIONS = [
  'purchaseReceipts',
  'farmerPayments',
  'companyPayments',
  'receiptNumberCounters',
  'apricotTypes',
  'farmers',
  'companies',
  'seasons'
] as const;

type SyncTable = (typeof SYNC_TABLES)[number];

let cachedApp: FirebaseApp | null = null;
let cachedSettingsKey = '';
const tableColumnsCache = new Map<string, Set<string>>();

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function rowToFirestoreData(row: Record<string, unknown>, tableName: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    data[toCamelCase(key)] = value;
  }

  data.localId = row.id;
  data.sourceTable = tableName;
  data.syncedAt = serverTimestamp();

  return data;
}

function normalizeFirestoreValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return value;
}

function getTableColumns(tableName: string): Set<string> {
  const cached = tableColumnsCache.get(tableName);

  if (cached) {
    return cached;
  }

  const rows = getDatabase().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const columns = new Set(rows.map((row) => row.name));
  tableColumnsCache.set(tableName, columns);

  return columns;
}

function firestoreDataToSqlRow(
  id: string,
  tableName: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const columns = getTableColumns(tableName);
  const row: Record<string, unknown> = {};
  const timestamp = new Date().toISOString();

  for (const [key, value] of Object.entries(data)) {
    if (key === 'localId' || key === 'sourceTable' || key === 'syncedAt') {
      continue;
    }

    const columnName = toSnakeCase(key);

    if (columns.has(columnName)) {
      row[columnName] = normalizeFirestoreValue(value);
    }
  }

  row.id = String(data.localId ?? data.id ?? id);

  if (columns.has('cloud_id')) {
    row.cloud_id = data.cloudId ? String(data.cloudId) : id;
  }

  if (columns.has('sync_status')) {
    row.sync_status = 'synced';
  }

  if (columns.has('created_at') && !row.created_at) {
    row.created_at = row.updated_at ?? timestamp;
  }

  if (columns.has('updated_at') && !row.updated_at) {
    row.updated_at = row.created_at ?? timestamp;
  }

  if (columns.has('deleted_at') && !('deleted_at' in row)) {
    row.deleted_at = null;
  }

  if (columns.has('cancelled_at') && !('cancelled_at' in row)) {
    row.cancelled_at = null;
  }

  if (columns.has('cancel_reason') && !('cancel_reason' in row)) {
    row.cancel_reason = null;
  }

  if (columns.has('version') && !row.version) {
    row.version = 1;
  }

  if (columns.has('is_active') && row.is_active === undefined) {
    row.is_active = 1;
  }

  if (columns.has('is_cancelled') && row.is_cancelled === undefined) {
    row.is_cancelled = 0;
  }

  return row;
}

function isLocalDirty(syncStatus: unknown): boolean {
  return (
    syncStatus === 'pending_create' ||
    syncStatus === 'pending_update' ||
    syncStatus === 'pending_delete' ||
    syncStatus === 'sync_error'
  );
}

function upsertPulledRow(table: SyncTable, row: Record<string, unknown>): boolean {
  const id = String(row.id ?? '');

  if (!id) {
    return false;
  }

  const db = getDatabase();
  const columns = getTableColumns(table.tableName);
  const keys = Object.keys(row).filter((key) => columns.has(key));
  const existing = db
    .prepare(`SELECT sync_status FROM ${table.tableName} WHERE id = ?`)
    .get(id) as { sync_status: string } | undefined;

  if (existing && isLocalDirty(existing.sync_status)) {
    return false;
  }

  if (existing) {
    const updateKeys = keys.filter((key) => key !== 'id');

    if (updateKeys.length === 0) {
      return false;
    }

    db.prepare(
      `
      UPDATE ${table.tableName}
      SET ${updateKeys.map((key) => `${key} = @${key}`).join(', ')}
      WHERE id = @id
      `
    ).run(row);
    return true;
  }

  db.prepare(
    `
    INSERT INTO ${table.tableName} (${keys.join(', ')})
    VALUES (${keys.map((key) => `@${key}`).join(', ')})
    `
  ).run(row);

  return true;
}

function settingsToFirebaseConfig(settings: FirebaseSettings): Record<string, string> {
  return {
    apiKey: settings.apiKey,
    authDomain: settings.authDomain,
    projectId: settings.projectId,
    storageBucket: settings.storageBucket,
    messagingSenderId: settings.messagingSenderId,
    appId: settings.appId
  };
}

async function getSyncApp(settings: FirebaseSettings): Promise<FirebaseApp> {
  const settingsKey = JSON.stringify(settingsToFirebaseConfig(settings));

  if (cachedApp && cachedSettingsKey === settingsKey) {
    return cachedApp;
  }

  const existing = getApps().find((app) => app.name === APP_NAME);

  if (existing) {
    await deleteApp(existing);
  }

  cachedApp = initializeApp(settingsToFirebaseConfig(settings), APP_NAME);
  cachedSettingsKey = settingsKey;

  return cachedApp;
}

async function signInForSync(app: FirebaseApp, settings: FirebaseSettings): Promise<void> {
  const auth = getAuth(app);

  if (auth.currentUser?.email === settings.authEmail) {
    return;
  }

  await signInWithEmailAndPassword(auth, settings.authEmail, settings.authPassword);
}

function getPendingRows(table: SyncTable): Array<Record<string, unknown>> {
  return getDatabase()
    .prepare(
      `
      SELECT *
      FROM ${table.tableName}
      WHERE sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'sync_error')
      ORDER BY updated_at ASC
      LIMIT 100
      `
    )
    .all() as Array<Record<string, unknown>>;
}

function markSynced(tableName: string, id: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE ${tableName}
      SET sync_status = 'synced',
          cloud_id = COALESCE(cloud_id, id)
      WHERE id = @id
      `
    )
    .run({ id });
}

function markSyncError(tableName: string, id: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE ${tableName}
      SET sync_status = 'sync_error'
      WHERE id = @id
      `
    )
    .run({ id });
}

function rebuildDerivedSummaries(): void {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  const rebuild = db.transaction(() => {
    db.prepare('DELETE FROM daily_company_summaries').run();
    db.prepare('DELETE FROM daily_type_summaries').run();
    db.prepare('DELETE FROM season_summaries').run();

    db.prepare(
      `
      INSERT INTO daily_company_summaries (
        id, season_id, date_key, company_id, company_name,
        total_gram, total_amount_kurus, receipt_count, updated_at
      )
      SELECT lower(hex(randomblob(16))), season_id, date_key, company_id, company_name,
             COALESCE(SUM(quantity_gram), 0),
             COALESCE(SUM(total_amount_kurus), 0),
             COUNT(*),
             @updatedAt
      FROM purchase_receipts
      WHERE deleted_at IS NULL AND is_cancelled = 0
      GROUP BY season_id, date_key, company_id, company_name
      `
    ).run({ updatedAt });

    db.prepare(
      `
      INSERT INTO daily_type_summaries (
        id, season_id, date_key, apricot_type_id, apricot_type_name,
        total_gram, total_amount_kurus, receipt_count, updated_at
      )
      SELECT lower(hex(randomblob(16))), season_id, date_key, apricot_type_id, apricot_type_name,
             COALESCE(SUM(quantity_gram), 0),
             COALESCE(SUM(total_amount_kurus), 0),
             COUNT(*),
             @updatedAt
      FROM purchase_receipts
      WHERE deleted_at IS NULL AND is_cancelled = 0
      GROUP BY season_id, date_key, apricot_type_id, apricot_type_name
      `
    ).run({ updatedAt });

    db.prepare(
      `
      INSERT INTO season_summaries (
        id, season_id, total_gram, total_amount_kurus, receipt_count,
        farmer_count, company_count, paid_to_farmers_kurus,
        collected_from_companies_kurus, farmer_balance_total_kurus,
        company_balance_total_kurus, updated_at
      )
      SELECT lower(hex(randomblob(16))),
             seasons.id,
             COALESCE(receipts.total_gram, 0),
             COALESCE(receipts.total_amount_kurus, 0),
             COALESCE(receipts.receipt_count, 0),
             (SELECT COUNT(*) FROM farmers WHERE deleted_at IS NULL AND is_active = 1),
             (SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL AND is_active = 1),
             COALESCE(farmer_payments.total_paid, 0),
             COALESCE(company_payments.total_collected, 0),
             (SELECT COALESCE(SUM(balance_kurus), 0) FROM farmers WHERE deleted_at IS NULL AND is_active = 1),
             (SELECT COALESCE(SUM(balance_kurus), 0) FROM companies WHERE deleted_at IS NULL AND is_active = 1),
             @updatedAt
      FROM seasons
      LEFT JOIN (
        SELECT season_id,
               COALESCE(SUM(quantity_gram), 0) AS total_gram,
               COALESCE(SUM(total_amount_kurus), 0) AS total_amount_kurus,
               COUNT(*) AS receipt_count
        FROM purchase_receipts
        WHERE deleted_at IS NULL AND is_cancelled = 0
        GROUP BY season_id
      ) receipts ON receipts.season_id = seasons.id
      LEFT JOIN (
        SELECT season_id, COALESCE(SUM(amount_kurus), 0) AS total_paid
        FROM farmer_payments
        WHERE deleted_at IS NULL AND is_cancelled = 0
        GROUP BY season_id
      ) farmer_payments ON farmer_payments.season_id = seasons.id
      LEFT JOIN (
        SELECT season_id, COALESCE(SUM(amount_kurus), 0) AS total_collected
        FROM company_payments
        WHERE deleted_at IS NULL AND is_cancelled = 0
        GROUP BY season_id
      ) company_payments ON company_payments.season_id = seasons.id
      WHERE seasons.deleted_at IS NULL
      `
    ).run({ updatedAt });
  });

  rebuild();
}

async function pullFirestoreRows(firestore: Firestore): Promise<number> {
  let pulledCount = 0;

  for (const table of SYNC_TABLES) {
    const snapshot = await getDocs(collection(firestore, table.collectionName));

    for (const firestoreDoc of snapshot.docs) {
      const row = firestoreDataToSqlRow(firestoreDoc.id, table.tableName, firestoreDoc.data());

      try {
        if (upsertPulledRow(table, row)) {
          pulledCount += 1;
        }
      } catch (error) {
        writeSyncLog(table.tableName, firestoreDoc.id, 'error', `Firebase'den alma: ${errorMessage(error)}`);
      }
    }
  }

  return pulledCount;
}

function writeSyncLog(tableName: string, entityId: string, status: 'success' | 'error', message: string | null): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO sync_logs (id, table_name, entity_id, operation, status, message, created_at)
      VALUES (@id, @tableName, @entityId, 'push', @status, @message, @createdAt)
      `
    )
    .run({
      id: randomUUID(),
      tableName,
      entityId,
      status,
      message,
      createdAt: new Date().toISOString()
    });
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code);

    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      return 'Online hesap e-postası veya şifresi hatalı. Firebase Authentication > Users bölümündeki hesapla aynı bilgileri gir.';
    }

    if (code === 'auth/operation-not-allowed') {
      return 'Firebase Authentication içinde Email/Password giriş yöntemi aktif değil.';
    }

    if (code === 'permission-denied') {
      return 'Firestore erişim izni reddedildi. Firestore Rules yayınlanmış mı kontrol et.';
    }
  }

  return error instanceof Error ? error.message : 'Senkron sırasında bilinmeyen hata oluştu.';
}

export function getSyncStatus(): SyncStatus {
  const db = getDatabase();
  const settings = getFirebaseSettings();
  const pendingCount = SYNC_TABLES.reduce((total, table) => {
    const row = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM ${table.tableName}
        WHERE sync_status IN ('pending_create', 'pending_update', 'pending_delete')
        `
      )
      .get() as { count: number };

    return total + row.count;
  }, 0);
  const errorCount = SYNC_TABLES.reduce((total, table) => {
    const row = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM ${table.tableName}
        WHERE sync_status = 'sync_error'
        `
      )
      .get() as { count: number };

    return total + row.count;
  }, 0);
  const lastErrorRow = db
    .prepare(
      `
      SELECT message
      FROM sync_logs
      WHERE status = 'error'
      ORDER BY created_at DESC
      LIMIT 1
      `
    )
    .get() as { message: string | null } | undefined;

  return {
    isConfigured: hasFirebaseSettings(settings),
    pendingCount,
    errorCount,
    lastSyncAt: getSetting('last_sync_at'),
    lastError: lastErrorRow?.message ?? null
  };
}

export async function runFirestoreSync(): Promise<SyncResult> {
  const settings = getFirebaseSettings();

  if (!hasFirebaseSettings(settings)) {
    throw new Error('Firebase ayarları eksik. Ayarlar ekranından Firebase bilgilerini gir.');
  }

  const app = await getSyncApp(settings);
  await signInForSync(app, settings);
  const firestore = getFirestore(app);
  let pushedCount = 0;
  let pulledCount = 0;

  for (const table of SYNC_TABLES) {
    const rows = getPendingRows(table);

    for (const row of rows) {
      const id = String(row.id ?? '');

      if (!id) {
        continue;
      }

      try {
        await setDoc(doc(firestore, table.collectionName, id), rowToFirestoreData(row, table.tableName), {
          merge: true
        });
        markSynced(table.tableName, id);
        writeSyncLog(table.tableName, id, 'success', null);
        pushedCount += 1;
      } catch (error) {
        const message = errorMessage(error);
        markSyncError(table.tableName, id);
        writeSyncLog(table.tableName, id, 'error', message);
        throw new Error(message);
      }
    }
  }

  try {
    pulledCount = await pullFirestoreRows(firestore);
  } catch (error) {
    throw new Error(errorMessage(error));
  }

  if (pulledCount > 0) {
    rebuildDerivedSummaries();
  }

  if (pushedCount > 0 || pulledCount > 0) {
    setSetting('last_sync_at', new Date().toISOString());
  }

  return {
    ...getSyncStatus(),
    pushedCount,
    pulledCount
  };
}

export async function clearFirestoreDataForReset(): Promise<{ deletedCount: number; skipped: boolean }> {
  const settings = getFirebaseSettings();

  if (!hasFirebaseSettings(settings)) {
    return { deletedCount: 0, skipped: true };
  }

  const app = await getSyncApp(settings);
  await signInForSync(app, settings);
  const firestore = getFirestore(app);
  let deletedCount = 0;

  for (const collectionName of RESET_FIRESTORE_COLLECTIONS) {
    const snapshot = await getDocs(collection(firestore, collectionName));

    for (const firestoreDoc of snapshot.docs) {
      await deleteDoc(doc(firestore, collectionName, firestoreDoc.id));
      deletedCount += 1;
    }
  }

  return { deletedCount, skipped: false };
}
