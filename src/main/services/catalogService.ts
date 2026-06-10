import { randomUUID } from 'node:crypto';
import type {
  ApricotTypeListItem,
  CompanyListItem,
  DashboardOverview,
  FarmerListItem,
  SaveApricotTypeInput,
  SaveCompanyInput,
  SaveFarmerInput,
  SaveSeasonInput,
  SeasonListItem
} from '../../shared/ipc-contracts/app-api';
import { toDateKey } from '../../shared/formatters';
import { getDatabase } from '../db/connection';

type BooleanNumber = 0 | 1;
const DEFAULT_SEASON_YEAR = 2026;
const DEFAULT_SEASON_NAME = '2026 Kayısı Sezonu';

interface SeasonRow {
  id: string;
  name: string;
  year: number;
  start_date: string | null;
  end_date: string | null;
  is_active: BooleanNumber;
}

interface FarmerRow {
  id: string;
  name: string;
  phone: string | null;
  village: string | null;
  note: string | null;
  is_active: BooleanNumber;
  total_gram: number;
  total_amount_kurus: number;
  paid_amount_kurus: number;
  balance_kurus: number;
  receipt_count: number;
}

interface CompanyRow {
  id: string;
  name: string;
  authorized_person: string | null;
  phone: string | null;
  city: string | null;
  note: string | null;
  is_active: BooleanNumber;
  total_gram: number;
  total_amount_kurus: number;
  collected_amount_kurus: number;
  balance_kurus: number;
  receipt_count: number;
}

interface ApricotTypeRow {
  id: string;
  name: string;
  is_active: BooleanNumber;
  sort_order: number;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} boş bırakılamaz.`);
  }

  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextSyncStatus(existingSyncStatus: string | undefined): string {
  return existingSyncStatus === 'synced' ? 'pending_update' : 'pending_create';
}

function mapSeason(row: SeasonRow): SeasonListItem {
  return {
    id: row.id,
    name: row.name,
    year: row.year,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active === 1
  };
}

function mapFarmer(row: FarmerRow): FarmerListItem {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    village: row.village,
    note: row.note,
    isActive: row.is_active === 1,
    totalGram: row.total_gram,
    totalAmountKurus: row.total_amount_kurus,
    paidAmountKurus: row.paid_amount_kurus,
    balanceKurus: row.balance_kurus,
    receiptCount: row.receipt_count
  };
}

function mapCompany(row: CompanyRow): CompanyListItem {
  return {
    id: row.id,
    name: row.name,
    authorizedPerson: row.authorized_person,
    phone: row.phone,
    city: row.city,
    note: row.note,
    isActive: row.is_active === 1,
    totalGram: row.total_gram,
    totalAmountKurus: row.total_amount_kurus,
    collectedAmountKurus: row.collected_amount_kurus,
    balanceKurus: row.balance_kurus,
    receiptCount: row.receipt_count
  };
}

function mapApricotType(row: ApricotTypeRow): ApricotTypeListItem {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order
  };
}

export function listSeasons(): SeasonListItem[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, name, year, start_date, end_date, is_active
      FROM seasons
      WHERE deleted_at IS NULL
      ORDER BY is_active DESC, year DESC, created_at DESC
      `
    )
    .all() as SeasonRow[];

  return rows.map(mapSeason);
}

function findActiveSeason(): SeasonListItem | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT id, name, year, start_date, end_date, is_active
      FROM seasons
      WHERE deleted_at IS NULL AND is_active = 1
      ORDER BY year DESC, created_at DESC
      LIMIT 1
      `
    )
    .get() as SeasonRow | undefined;

  return row ? mapSeason(row) : null;
}

function findDefaultSeason(): SeasonListItem | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT id, name, year, start_date, end_date, is_active
      FROM seasons
      WHERE deleted_at IS NULL AND year = ?
      ORDER BY created_at ASC
      LIMIT 1
      `
    )
    .get(DEFAULT_SEASON_YEAR) as SeasonRow | undefined;

  return row ? mapSeason(row) : null;
}

export function ensureActiveSeason(): SeasonListItem {
  const defaultSeason = findDefaultSeason();

  if (defaultSeason) {
    if (!defaultSeason.isActive) {
      return setActiveSeason(defaultSeason.id);
    }

    return defaultSeason;
  }

  const activeSeason = findActiveSeason();

  if (activeSeason?.year === DEFAULT_SEASON_YEAR) {
    return activeSeason;
  }

  return saveSeason({
    name: DEFAULT_SEASON_NAME,
    year: DEFAULT_SEASON_YEAR,
    isActive: true
  });
}

export function getActiveSeason(): SeasonListItem {
  return ensureActiveSeason();
}

export function saveSeason(input: SaveSeasonInput): SeasonListItem {
  const db = getDatabase();
  const name = requiredText(input.name, 'Sezon adı');
  const year = Number(input.year);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('Sezon yılı geçerli olmalı.');
  }

  const save = db.transaction(() => {
    const timestamp = nowIso();
    const id = input.id ?? randomUUID();
    const existing = input.id
      ? (db.prepare('SELECT sync_status FROM seasons WHERE id = ?').get(input.id) as
          | { sync_status: string }
          | undefined)
      : undefined;

    if (input.isActive !== false) {
      db.prepare(
        `
        UPDATE seasons
        SET is_active = 0,
            updated_at = ?,
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
            version = version + 1
        WHERE deleted_at IS NULL AND id <> ?
        `
      ).run(timestamp, id);
    }

    if (existing) {
      db.prepare(
        `
        UPDATE seasons
        SET name = @name,
            year = @year,
            start_date = @startDate,
            end_date = @endDate,
            is_active = @isActive,
            sync_status = @syncStatus,
            updated_at = @updatedAt,
            version = version + 1
        WHERE id = @id
        `
      ).run({
        id,
        name,
        year,
        startDate: optionalText(input.startDate),
        endDate: optionalText(input.endDate),
        isActive: input.isActive === false ? 0 : 1,
        syncStatus: nextSyncStatus(existing.sync_status),
        updatedAt: timestamp
      });
    } else {
      db.prepare(
        `
        INSERT INTO seasons (
          id, cloud_id, name, year, start_date, end_date, is_active,
          sync_status, created_at, updated_at, deleted_at, version
        )
        VALUES (
          @id, NULL, @name, @year, @startDate, @endDate, @isActive,
          'pending_create', @createdAt, @updatedAt, NULL, 1
        )
        `
      ).run({
        id,
        name,
        year,
        startDate: optionalText(input.startDate),
        endDate: optionalText(input.endDate),
        isActive: input.isActive === false ? 0 : 1,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      db.prepare(
        `
        INSERT OR IGNORE INTO season_summaries (
          id, season_id, total_gram, total_amount_kurus, receipt_count,
          farmer_count, company_count, paid_to_farmers_kurus,
          collected_from_companies_kurus, farmer_balance_total_kurus,
          company_balance_total_kurus, updated_at
        )
        VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
        `
      ).run(randomUUID(), id, timestamp);
    }

    const row = db
      .prepare('SELECT id, name, year, start_date, end_date, is_active FROM seasons WHERE id = ?')
      .get(id) as SeasonRow;

    return mapSeason(row);
  });

  return save();
}

export function setActiveSeason(id: string): SeasonListItem {
  const db = getDatabase();
  const activate = db.transaction(() => {
    const timestamp = nowIso();
    const existing = db
      .prepare('SELECT id FROM seasons WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: string } | undefined;

    if (!existing) {
      throw new Error('Sezon bulunamadı.');
    }

    db.prepare(
      `
      UPDATE seasons
      SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END,
          updated_at = ?,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          version = version + 1
      WHERE deleted_at IS NULL
      `
    ).run(id, timestamp);

    const row = db
      .prepare('SELECT id, name, year, start_date, end_date, is_active FROM seasons WHERE id = ?')
      .get(id) as SeasonRow;

    return mapSeason(row);
  });

  return activate();
}

export function listFarmers(search = ''): FarmerListItem[] {
  const normalizedSearch = `%${search.trim()}%`;
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, name, phone, village, note, is_active, total_gram, total_amount_kurus,
             paid_amount_kurus, balance_kurus, receipt_count
      FROM farmers
      WHERE deleted_at IS NULL
        AND (@search = '%%' OR name LIKE @search OR village LIKE @search OR phone LIKE @search)
      ORDER BY is_active DESC, name ASC
      LIMIT 500
      `
    )
    .all({ search: normalizedSearch }) as FarmerRow[];

  return rows.map(mapFarmer);
}

export function saveFarmer(input: SaveFarmerInput): FarmerListItem {
  const db = getDatabase();
  const name = requiredText(input.name, 'Çiftçi adı');
  const timestamp = nowIso();
  const id = input.id ?? randomUUID();
  const existing = input.id
    ? (db.prepare('SELECT sync_status FROM farmers WHERE id = ?').get(input.id) as
        | { sync_status: string }
        | undefined)
    : undefined;

  if (existing) {
    db.prepare(
      `
      UPDATE farmers
      SET name = @name,
          phone = @phone,
          village = @village,
          note = @note,
          is_active = @isActive,
          sync_status = @syncStatus,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @id
      `
    ).run({
      id,
      name,
      phone: optionalText(input.phone),
      village: optionalText(input.village),
      note: optionalText(input.note),
      isActive: input.isActive === false ? 0 : 1,
      syncStatus: nextSyncStatus(existing.sync_status),
      updatedAt: timestamp
    });
  } else {
    db.prepare(
      `
      INSERT INTO farmers (
        id, cloud_id, name, phone, village, note, is_active,
        total_gram, total_amount_kurus, paid_amount_kurus, balance_kurus,
        receipt_count, sync_status, created_at, updated_at, deleted_at, version
      )
      VALUES (
        @id, NULL, @name, @phone, @village, @note, 1,
        0, 0, 0, 0, 0, 'pending_create', @createdAt, @updatedAt, NULL, 1
      )
      `
    ).run({
      id,
      name,
      phone: optionalText(input.phone),
      village: optionalText(input.village),
      note: optionalText(input.note),
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  const row = db
    .prepare(
      `
      SELECT id, name, phone, village, note, is_active, total_gram, total_amount_kurus,
             paid_amount_kurus, balance_kurus, receipt_count
      FROM farmers
      WHERE id = ?
      `
    )
    .get(id) as FarmerRow;

  return mapFarmer(row);
}

export function deactivateFarmer(id: string): void {
  const timestamp = nowIso();

  getDatabase()
    .prepare(
      `
      UPDATE farmers
      SET is_active = 0,
          deleted_at = @deletedAt,
          updated_at = @updatedAt,
          sync_status = 'pending_delete',
          version = version + 1
      WHERE id = @id AND deleted_at IS NULL
      `
    )
    .run({ id, deletedAt: timestamp, updatedAt: timestamp });
}

export function listCompanies(search = ''): CompanyListItem[] {
  const normalizedSearch = `%${search.trim()}%`;
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, name, authorized_person, phone, city, note, is_active, total_gram,
             total_amount_kurus, collected_amount_kurus, balance_kurus, receipt_count
      FROM companies
      WHERE deleted_at IS NULL
        AND (@search = '%%' OR name LIKE @search OR city LIKE @search OR phone LIKE @search)
      ORDER BY is_active DESC, name ASC
      LIMIT 500
      `
    )
    .all({ search: normalizedSearch }) as CompanyRow[];

  return rows.map(mapCompany);
}

export function saveCompany(input: SaveCompanyInput): CompanyListItem {
  const db = getDatabase();
  const name = requiredText(input.name, 'Firma adı');
  const timestamp = nowIso();
  const id = input.id ?? randomUUID();
  const existing = input.id
    ? (db.prepare('SELECT sync_status FROM companies WHERE id = ?').get(input.id) as
        | { sync_status: string }
        | undefined)
    : undefined;

  if (existing) {
    db.prepare(
      `
      UPDATE companies
      SET name = @name,
          authorized_person = @authorizedPerson,
          phone = @phone,
          city = @city,
          note = @note,
          is_active = @isActive,
          sync_status = @syncStatus,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @id
      `
    ).run({
      id,
      name,
      authorizedPerson: optionalText(input.authorizedPerson),
      phone: optionalText(input.phone),
      city: optionalText(input.city),
      note: optionalText(input.note),
      isActive: input.isActive === false ? 0 : 1,
      syncStatus: nextSyncStatus(existing.sync_status),
      updatedAt: timestamp
    });
  } else {
    db.prepare(
      `
      INSERT INTO companies (
        id, cloud_id, name, authorized_person, phone, city, note, is_active,
        total_gram, total_amount_kurus, collected_amount_kurus, balance_kurus,
        receipt_count, sync_status, created_at, updated_at, deleted_at, version
      )
      VALUES (
        @id, NULL, @name, @authorizedPerson, @phone, @city, @note, 1,
        0, 0, 0, 0, 0, 'pending_create', @createdAt, @updatedAt, NULL, 1
      )
      `
    ).run({
      id,
      name,
      authorizedPerson: optionalText(input.authorizedPerson),
      phone: optionalText(input.phone),
      city: optionalText(input.city),
      note: optionalText(input.note),
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  const row = db
    .prepare(
      `
      SELECT id, name, authorized_person, phone, city, note, is_active, total_gram,
             total_amount_kurus, collected_amount_kurus, balance_kurus, receipt_count
      FROM companies
      WHERE id = ?
      `
    )
    .get(id) as CompanyRow;

  return mapCompany(row);
}

export function deactivateCompany(id: string): void {
  const timestamp = nowIso();

  getDatabase()
    .prepare(
      `
      UPDATE companies
      SET is_active = 0,
          deleted_at = @deletedAt,
          updated_at = @updatedAt,
          sync_status = 'pending_delete',
          version = version + 1
      WHERE id = @id AND deleted_at IS NULL
      `
    )
    .run({ id, deletedAt: timestamp, updatedAt: timestamp });
}

export function listApricotTypes(): ApricotTypeListItem[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, name, is_active, sort_order
      FROM apricot_types
      WHERE deleted_at IS NULL
      ORDER BY is_active DESC, sort_order ASC, name ASC
      `
    )
    .all() as ApricotTypeRow[];

  return rows.map(mapApricotType);
}

export function saveApricotType(input: SaveApricotTypeInput): ApricotTypeListItem {
  const db = getDatabase();
  const name = requiredText(input.name, 'Kayısı çeşidi');
  const timestamp = nowIso();
  const id = input.id ?? randomUUID();
  let sortOrder = Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0;
  const existing = input.id
    ? (db.prepare('SELECT sync_status FROM apricot_types WHERE id = ?').get(input.id) as
        | { sync_status: string }
        | undefined)
    : undefined;

  if (!existing && sortOrder <= 0) {
    const nextSort = db
      .prepare(
        `
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
        FROM apricot_types
        WHERE deleted_at IS NULL
        `
      )
      .get() as { next_sort_order: number };

    sortOrder = nextSort.next_sort_order;
  }

  if (existing) {
    db.prepare(
      `
      UPDATE apricot_types
      SET name = @name,
          sort_order = @sortOrder,
          is_active = @isActive,
          sync_status = @syncStatus,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @id
      `
    ).run({
      id,
      name,
      sortOrder,
      isActive: input.isActive === false ? 0 : 1,
      syncStatus: nextSyncStatus(existing.sync_status),
      updatedAt: timestamp
    });
  } else {
    db.prepare(
      `
      INSERT INTO apricot_types (
        id, cloud_id, name, is_active, sort_order, sync_status,
        created_at, updated_at, deleted_at, version
      )
      VALUES (@id, NULL, @name, 1, @sortOrder, 'pending_create', @createdAt, @updatedAt, NULL, 1)
      `
    ).run({
      id,
      name,
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  const row = db
    .prepare('SELECT id, name, is_active, sort_order FROM apricot_types WHERE id = ?')
    .get(id) as ApricotTypeRow;

  return mapApricotType(row);
}

export function deactivateApricotType(id: string): void {
  const timestamp = nowIso();

  getDatabase()
    .prepare(
      `
      UPDATE apricot_types
      SET is_active = 0,
          deleted_at = @deletedAt,
          updated_at = @updatedAt,
          sync_status = 'pending_delete',
          version = version + 1
      WHERE id = @id AND deleted_at IS NULL
      `
    )
    .run({ id, deletedAt: timestamp, updatedAt: timestamp });
}

export function getDashboardOverview(): DashboardOverview {
  const db = getDatabase();
  const todayKey = toDateKey(new Date());

  const receiptToday = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(quantity_gram), 0) AS total_gram,
        COALESCE(SUM(total_amount_kurus), 0) AS total_amount_kurus
      FROM purchase_receipts
      WHERE deleted_at IS NULL AND is_cancelled = 0 AND date_key = ?
      `
    )
    .get(todayKey) as { total_gram: number; total_amount_kurus: number };

  const farmerPaymentsToday = db
    .prepare(
      `
      SELECT COALESCE(SUM(amount_kurus), 0) AS total
      FROM farmer_payments
      WHERE deleted_at IS NULL AND is_cancelled = 0 AND date_key = ?
      `
    )
    .get(todayKey) as { total: number };

  const companyPaymentsToday = db
    .prepare(
      `
      SELECT COALESCE(SUM(amount_kurus), 0) AS total
      FROM company_payments
      WHERE deleted_at IS NULL AND is_cancelled = 0 AND date_key = ?
      `
    )
    .get(todayKey) as { total: number };

  const farmerTotals = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(balance_kurus), 0) AS balance
      FROM farmers
      WHERE deleted_at IS NULL AND is_active = 1
      `
    )
    .get() as { count: number; balance: number };

  const companyTotals = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(balance_kurus), 0) AS balance
      FROM companies
      WHERE deleted_at IS NULL AND is_active = 1
      `
    )
    .get() as { count: number; balance: number };

  return {
    todayTotalGram: receiptToday.total_gram,
    todayTotalAmountKurus: receiptToday.total_amount_kurus,
    farmerBalanceTotalKurus: farmerTotals.balance,
    companyBalanceTotalKurus: companyTotals.balance,
    todayPaidToFarmersKurus: farmerPaymentsToday.total,
    todayCollectedFromCompaniesKurus: companyPaymentsToday.total,
    farmerCount: farmerTotals.count,
    companyCount: companyTotals.count
  };
}
