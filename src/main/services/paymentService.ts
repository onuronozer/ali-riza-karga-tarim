import { randomUUID } from 'node:crypto';
import type {
  CancelInput,
  CompanyPaymentListItem,
  FarmerPaymentListItem,
  PaymentMethod,
  SaveCompanyPaymentInput,
  SaveFarmerPaymentInput
} from '../../shared/ipc-contracts/app-api';
import { getDatabase } from '../db/connection';
import { ensureActiveSeason } from './catalogService';

type BooleanNumber = 0 | 1;

interface EntityNameRow {
  id: string;
  name: string;
  nickname: string | null;
}

interface FarmerPaymentRow {
  id: string;
  season_id: string;
  farmer_id: string;
  farmer_name: string;
  date: string;
  date_key: string;
  amount_kurus: number;
  payment_method: PaymentMethod;
  note: string | null;
  is_cancelled: BooleanNumber;
}

interface CompanyPaymentRow {
  id: string;
  season_id: string;
  company_id: string;
  company_name: string;
  date: string;
  date_key: string;
  amount_kurus: number;
  payment_method: PaymentMethod;
  note: string | null;
  is_cancelled: BooleanNumber;
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

function dateToDateKey(date: string): string {
  const normalized = requiredText(date, 'Tarih');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('Tarih geçerli olmalı.');
  }

  return normalized.replace(/-/g, '');
}

function normalizeAmount(amountKurus: number): number {
  const amount = Math.round(Number(amountKurus));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Ödeme tutarı sıfırdan büyük olmalı.');
  }

  return amount;
}

function normalizePaymentMethod(method: PaymentMethod): PaymentMethod {
  if (method !== 'cash' && method !== 'bank' && method !== 'other') {
    throw new Error('Ödeme yöntemi geçerli olmalı.');
  }

  return method;
}

function getEntityName(tableName: 'farmers' | 'companies', id: string, label: string): EntityNameRow {
  const selectColumns = tableName === 'farmers' ? 'id, name, nickname' : 'id, name, NULL AS nickname';
  const row = getDatabase()
    .prepare(
      `
      SELECT ${selectColumns}
      FROM ${tableName}
      WHERE id = ? AND deleted_at IS NULL AND is_active = 1
      `
    )
    .get(id) as EntityNameRow | undefined;

  if (!row) {
    throw new Error(`${label} bulunamadı veya pasif.`);
  }

  return row;
}

function displayEntityName(row: EntityNameRow): string {
  return row.nickname ? `${row.name} (${row.nickname})` : row.name;
}

function ensureSeasonSummary(seasonId: string, timestamp: string): void {
  getDatabase()
    .prepare(
      `
      INSERT OR IGNORE INTO season_summaries (
        id, season_id, total_gram, total_amount_kurus, receipt_count,
        farmer_count, company_count, paid_to_farmers_kurus,
        collected_from_companies_kurus, farmer_balance_total_kurus,
        company_balance_total_kurus, updated_at
      )
      VALUES (@id, @seasonId, 0, 0, 0, 0, 0, 0, 0, 0, 0, @updatedAt)
      `
    )
    .run({ id: randomUUID(), seasonId, updatedAt: timestamp });
}

function updateSeasonBalances(seasonId: string, timestamp: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE season_summaries
      SET farmer_count = (SELECT COUNT(*) FROM farmers WHERE deleted_at IS NULL AND is_active = 1),
          company_count = (SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL AND is_active = 1),
          farmer_balance_total_kurus = (SELECT COALESCE(SUM(balance_kurus), 0) FROM farmers WHERE deleted_at IS NULL AND is_active = 1),
          company_balance_total_kurus = (SELECT COALESCE(SUM(balance_kurus), 0) FROM companies WHERE deleted_at IS NULL AND is_active = 1),
          updated_at = @updatedAt
      WHERE season_id = @seasonId
      `
    )
    .run({ seasonId, updatedAt: timestamp });
}

function mapFarmerPayment(row: FarmerPaymentRow): FarmerPaymentListItem {
  return {
    id: row.id,
    seasonId: row.season_id,
    farmerId: row.farmer_id,
    farmerName: row.farmer_name,
    date: row.date,
    dateKey: row.date_key,
    amountKurus: row.amount_kurus,
    paymentMethod: row.payment_method,
    note: row.note,
    isCancelled: row.is_cancelled === 1
  };
}

function mapCompanyPayment(row: CompanyPaymentRow): CompanyPaymentListItem {
  return {
    id: row.id,
    seasonId: row.season_id,
    companyId: row.company_id,
    companyName: row.company_name,
    date: row.date,
    dateKey: row.date_key,
    amountKurus: row.amount_kurus,
    paymentMethod: row.payment_method,
    note: row.note,
    isCancelled: row.is_cancelled === 1
  };
}

export function listFarmerPayments(): FarmerPaymentListItem[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, season_id, farmer_id, farmer_name, date, date_key, amount_kurus,
             payment_method, note, is_cancelled
      FROM farmer_payments
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 2000
      `
    )
    .all() as FarmerPaymentRow[];

  return rows.map(mapFarmerPayment);
}

export function createFarmerPayment(input: SaveFarmerPaymentInput): FarmerPaymentListItem {
  const db = getDatabase();
  const create = db.transaction(() => {
    const season = ensureActiveSeason();
    const farmer = getEntityName('farmers', input.farmerId, 'Çiftçi');
    const date = requiredText(input.date, 'Tarih');
    const dateKey = dateToDateKey(date);
    const amountKurus = normalizeAmount(input.amountKurus);
    const paymentMethod = normalizePaymentMethod(input.paymentMethod);
    const timestamp = nowIso();
    const id = randomUUID();

    db.prepare(
      `
      INSERT INTO farmer_payments (
        id, cloud_id, season_id, farmer_id, farmer_name, date, date_key, amount_kurus,
        payment_method, note, is_cancelled, cancelled_at, cancel_reason, sync_status,
        created_at, updated_at, deleted_at, version
      )
      VALUES (
        @id, NULL, @seasonId, @farmerId, @farmerName, @date, @dateKey, @amountKurus,
        @paymentMethod, @note, 0, NULL, NULL, 'pending_create',
        @createdAt, @updatedAt, NULL, 1
      )
      `
    ).run({
      id,
      seasonId: season.id,
      farmerId: farmer.id,
      farmerName: displayEntityName(farmer),
      date,
      dateKey,
      amountKurus,
      paymentMethod,
      note: optionalText(input.note),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    db.prepare(
      `
      UPDATE farmers
      SET paid_amount_kurus = paid_amount_kurus + @amountKurus,
          balance_kurus = balance_kurus - @amountKurus,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @farmerId
      `
    ).run({ amountKurus, updatedAt: timestamp, farmerId: farmer.id });

    ensureSeasonSummary(season.id, timestamp);
    db.prepare(
      `
      UPDATE season_summaries
      SET paid_to_farmers_kurus = paid_to_farmers_kurus + @amountKurus,
          updated_at = @updatedAt
      WHERE season_id = @seasonId
      `
    ).run({ amountKurus, updatedAt: timestamp, seasonId: season.id });
    updateSeasonBalances(season.id, timestamp);

    const row = db
      .prepare(
        `
        SELECT id, season_id, farmer_id, farmer_name, date, date_key, amount_kurus,
               payment_method, note, is_cancelled
        FROM farmer_payments
        WHERE id = ?
        `
      )
      .get(id) as FarmerPaymentRow;

    return mapFarmerPayment(row);
  });

  return create();
}

export function cancelFarmerPayment(input: CancelInput): void {
  const db = getDatabase();
  const cancel = db.transaction(() => {
    const reason = requiredText(input.reason, 'İptal nedeni');
    const timestamp = nowIso();
    const payment = db
      .prepare(
        `
        SELECT id, season_id, farmer_id, farmer_name, date, date_key, amount_kurus,
               payment_method, note, is_cancelled
        FROM farmer_payments
        WHERE id = ? AND deleted_at IS NULL
        `
      )
      .get(input.id) as FarmerPaymentRow | undefined;

    if (!payment) {
      throw new Error('Çiftçi ödemesi bulunamadı.');
    }

    if (payment.is_cancelled === 1) {
      throw new Error('Bu ödeme zaten iptal edilmiş.');
    }

    db.prepare(
      `
      UPDATE farmer_payments
      SET is_cancelled = 1,
          cancelled_at = @cancelledAt,
          cancel_reason = @cancelReason,
          updated_at = @updatedAt,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          version = version + 1
      WHERE id = @id
      `
    ).run({
      id: payment.id,
      cancelledAt: timestamp,
      cancelReason: reason,
      updatedAt: timestamp
    });

    db.prepare(
      `
      UPDATE farmers
      SET paid_amount_kurus = paid_amount_kurus - @amountKurus,
          balance_kurus = balance_kurus + @amountKurus,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @farmerId
      `
    ).run({ amountKurus: payment.amount_kurus, updatedAt: timestamp, farmerId: payment.farmer_id });

    db.prepare(
      `
      UPDATE season_summaries
      SET paid_to_farmers_kurus = paid_to_farmers_kurus - @amountKurus,
          updated_at = @updatedAt
      WHERE season_id = @seasonId
      `
    ).run({ amountKurus: payment.amount_kurus, updatedAt: timestamp, seasonId: payment.season_id });
    updateSeasonBalances(payment.season_id, timestamp);
  });

  cancel();
}

export function listCompanyPayments(): CompanyPaymentListItem[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, season_id, company_id, company_name, date, date_key, amount_kurus,
             payment_method, note, is_cancelled
      FROM company_payments
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 2000
      `
    )
    .all() as CompanyPaymentRow[];

  return rows.map(mapCompanyPayment);
}

export function createCompanyPayment(input: SaveCompanyPaymentInput): CompanyPaymentListItem {
  const db = getDatabase();
  const create = db.transaction(() => {
    const season = ensureActiveSeason();
    const company = getEntityName('companies', input.companyId, 'Firma');
    const date = requiredText(input.date, 'Tarih');
    const dateKey = dateToDateKey(date);
    const amountKurus = normalizeAmount(input.amountKurus);
    const paymentMethod = normalizePaymentMethod(input.paymentMethod);
    const timestamp = nowIso();
    const id = randomUUID();

    db.prepare(
      `
      INSERT INTO company_payments (
        id, cloud_id, season_id, company_id, company_name, date, date_key, amount_kurus,
        payment_method, note, is_cancelled, cancelled_at, cancel_reason, sync_status,
        created_at, updated_at, deleted_at, version
      )
      VALUES (
        @id, NULL, @seasonId, @companyId, @companyName, @date, @dateKey, @amountKurus,
        @paymentMethod, @note, 0, NULL, NULL, 'pending_create',
        @createdAt, @updatedAt, NULL, 1
      )
      `
    ).run({
      id,
      seasonId: season.id,
      companyId: company.id,
      companyName: company.name,
      date,
      dateKey,
      amountKurus,
      paymentMethod,
      note: optionalText(input.note),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    db.prepare(
      `
      UPDATE companies
      SET collected_amount_kurus = collected_amount_kurus + @amountKurus,
          balance_kurus = balance_kurus - @amountKurus,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @companyId
      `
    ).run({ amountKurus, updatedAt: timestamp, companyId: company.id });

    ensureSeasonSummary(season.id, timestamp);
    db.prepare(
      `
      UPDATE season_summaries
      SET collected_from_companies_kurus = collected_from_companies_kurus + @amountKurus,
          updated_at = @updatedAt
      WHERE season_id = @seasonId
      `
    ).run({ amountKurus, updatedAt: timestamp, seasonId: season.id });
    updateSeasonBalances(season.id, timestamp);

    const row = db
      .prepare(
        `
        SELECT id, season_id, company_id, company_name, date, date_key, amount_kurus,
               payment_method, note, is_cancelled
        FROM company_payments
        WHERE id = ?
        `
      )
      .get(id) as CompanyPaymentRow;

    return mapCompanyPayment(row);
  });

  return create();
}

export function cancelCompanyPayment(input: CancelInput): void {
  const db = getDatabase();
  const cancel = db.transaction(() => {
    const reason = requiredText(input.reason, 'İptal nedeni');
    const timestamp = nowIso();
    const payment = db
      .prepare(
        `
        SELECT id, season_id, company_id, company_name, date, date_key, amount_kurus,
               payment_method, note, is_cancelled
        FROM company_payments
        WHERE id = ? AND deleted_at IS NULL
        `
      )
      .get(input.id) as CompanyPaymentRow | undefined;

    if (!payment) {
      throw new Error('Firma ödemesi bulunamadı.');
    }

    if (payment.is_cancelled === 1) {
      throw new Error('Bu ödeme zaten iptal edilmiş.');
    }

    db.prepare(
      `
      UPDATE company_payments
      SET is_cancelled = 1,
          cancelled_at = @cancelledAt,
          cancel_reason = @cancelReason,
          updated_at = @updatedAt,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          version = version + 1
      WHERE id = @id
      `
    ).run({
      id: payment.id,
      cancelledAt: timestamp,
      cancelReason: reason,
      updatedAt: timestamp
    });

    db.prepare(
      `
      UPDATE companies
      SET collected_amount_kurus = collected_amount_kurus - @amountKurus,
          balance_kurus = balance_kurus + @amountKurus,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @companyId
      `
    ).run({ amountKurus: payment.amount_kurus, updatedAt: timestamp, companyId: payment.company_id });

    db.prepare(
      `
      UPDATE season_summaries
      SET collected_from_companies_kurus = collected_from_companies_kurus - @amountKurus,
          updated_at = @updatedAt
      WHERE season_id = @seasonId
      `
    ).run({ amountKurus: payment.amount_kurus, updatedAt: timestamp, seasonId: payment.season_id });
    updateSeasonBalances(payment.season_id, timestamp);
  });

  cancel();
}
