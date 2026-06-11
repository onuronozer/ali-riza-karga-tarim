import { randomUUID } from 'node:crypto';
import type {
  CancelInput,
  PurchaseReceiptListItem,
  SavePurchaseReceiptInput
} from '../../shared/ipc-contracts/app-api';
import { getDatabase } from '../db/connection';
import { getSetting, setSetting } from '../repositories/settingsRepository';
import { ensureActiveSeason } from './catalogService';

interface EntityNameRow {
  id: string;
  name: string;
}

interface PurchaseReceiptRow {
  id: string;
  receipt_no: string;
  season_id: string;
  date: string;
  date_key: string;
  time_text: string;
  farmer_id: string;
  farmer_name: string;
  company_id: string;
  company_name: string;
  apricot_type_id: string;
  apricot_type_name: string;
  gross_quantity_gram: number;
  crate_count: number;
  crate_tare_gram: number;
  quantity_gram: number;
  unit_price_kurus: number;
  total_amount_kurus: number;
  note: string | null;
  is_cancelled: 0 | 1;
}

function updateSeasonTotals(seasonId: string, timestamp: string): void {
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

function mapReceipt(row: PurchaseReceiptRow): PurchaseReceiptListItem {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    seasonId: row.season_id,
    date: row.date,
    dateKey: row.date_key,
    timeText: row.time_text,
    farmerId: row.farmer_id,
    farmerName: row.farmer_name,
    companyId: row.company_id,
    companyName: row.company_name,
    apricotTypeId: row.apricot_type_id,
    apricotTypeName: row.apricot_type_name,
    grossQuantityGram: row.gross_quantity_gram || row.quantity_gram,
    crateCount: row.crate_count ?? 0,
    crateTareGram: row.crate_tare_gram ?? 0,
    quantityGram: row.quantity_gram,
    unitPriceKurus: row.unit_price_kurus,
    totalAmountKurus: row.total_amount_kurus,
    note: row.note,
    isCancelled: row.is_cancelled === 1
  };
}

function getDeviceCode(): string {
  const deviceCode = getSetting('device_code');

  if (!deviceCode) {
    throw new Error('Alım fişi için önce cihaz kodu tanımlayın.');
  }

  return deviceCode;
}

function getEntityName(tableName: 'farmers' | 'companies' | 'apricot_types', id: string, label: string): EntityNameRow {
  const row = getDatabase()
    .prepare(
      `
      SELECT id, name
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

function nextReceiptNo(dateKey: string, deviceCode: string): string {
  const db = getDatabase();
  const id = `${dateKey}-${deviceCode}`;
  const timestamp = nowIso();

  db.prepare(
    `
    INSERT INTO receipt_number_counters (id, date_key, device_code, last_number, updated_at)
    VALUES (@id, @dateKey, @deviceCode, 0, @updatedAt)
    ON CONFLICT(date_key, device_code) DO NOTHING
    `
  ).run({ id, dateKey, deviceCode, updatedAt: timestamp });

  const counter = db
    .prepare(
      `
      UPDATE receipt_number_counters
      SET last_number = last_number + 1,
          updated_at = @updatedAt
      WHERE date_key = @dateKey AND device_code = @deviceCode
      RETURNING last_number
      `
    )
    .get({ dateKey, deviceCode, updatedAt: timestamp }) as { last_number: number };

  return `${dateKey}-${deviceCode}-${String(counter.last_number).padStart(4, '0')}`;
}

export function listPurchaseReceipts(): PurchaseReceiptListItem[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, receipt_no, season_id, date, date_key, time_text, farmer_id, farmer_name,
             company_id, company_name, apricot_type_id, apricot_type_name,
             gross_quantity_gram, crate_count, crate_tare_gram, quantity_gram,
             unit_price_kurus, total_amount_kurus, note, is_cancelled
      FROM purchase_receipts
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 2000
      `
    )
    .all() as PurchaseReceiptRow[];

  return rows.map(mapReceipt);
}

export function createPurchaseReceipt(input: SavePurchaseReceiptInput): PurchaseReceiptListItem {
  const db = getDatabase();
  const create = db.transaction(() => {
    const season = ensureActiveSeason();
    const deviceCode = getDeviceCode();
    const date = requiredText(input.date, 'Tarih');
    const dateKey = dateToDateKey(date);
    const timeText = requiredText(input.timeText, 'Saat');
    const grossQuantityGram = Math.round(Number(input.grossQuantityGram ?? input.quantityGram));
    const crateCount = Math.max(0, Math.round(Number(input.crateCount ?? 0)));
    const crateTareGram = Math.round(Number(input.crateTareGram ?? 0));
    const totalTareGram = crateCount * crateTareGram;
    const quantityGram = Math.round(Number(input.quantityGram || grossQuantityGram - totalTareGram));
    const unitPriceKurus = Math.round(Number(input.unitPriceKurus));

    if (!Number.isFinite(grossQuantityGram) || grossQuantityGram <= 0) {
      throw new Error('Brut kg degeri sifirdan buyuk olmali.');
    }

    if (!Number.isFinite(crateCount) || crateCount < 0) {
      throw new Error('Kasa adedi gecerli olmali.');
    }

    if (![0, 1000, 2000, 3000, 4000].includes(crateTareGram)) {
      throw new Error('Dara 1, 2, 3 veya 4 kg secilmeli.');
    }

    if (totalTareGram >= grossQuantityGram) {
      throw new Error('Toplam dara brut kilodan fazla olamaz.');
    }

    if (!Number.isFinite(quantityGram) || quantityGram <= 0) {
      throw new Error('Kg değeri sıfırdan büyük olmalı.');
    }

    if (!Number.isFinite(unitPriceKurus) || unitPriceKurus <= 0) {
      throw new Error('Birim fiyat sıfırdan büyük olmalı.');
    }

    const farmer = getEntityName('farmers', input.farmerId, 'Çiftçi');
    const company = getEntityName('companies', input.companyId, 'Firma');
    const apricotType = getEntityName('apricot_types', input.apricotTypeId, 'Kayısı çeşidi');
    const totalAmountKurus = Math.round((quantityGram * unitPriceKurus) / 1000);
    const timestamp = nowIso();
    const id = randomUUID();
    const receiptNo = nextReceiptNo(dateKey, deviceCode);

    db.prepare(
      `
      INSERT INTO purchase_receipts (
        id, cloud_id, receipt_no, season_id, date, date_key, time_text,
        farmer_id, farmer_name, company_id, company_name, apricot_type_id, apricot_type_name,
        gross_quantity_gram, crate_count, crate_tare_gram,
        quantity_gram, unit_price_kurus, total_amount_kurus, note, is_cancelled,
        cancelled_at, cancel_reason, sync_status, created_at, updated_at, deleted_at, version
      )
      VALUES (
        @id, NULL, @receiptNo, @seasonId, @date, @dateKey, @timeText,
        @farmerId, @farmerName, @companyId, @companyName, @apricotTypeId, @apricotTypeName,
        @grossQuantityGram, @crateCount, @crateTareGram,
        @quantityGram, @unitPriceKurus, @totalAmountKurus, @note, 0,
        NULL, NULL, 'pending_create', @createdAt, @updatedAt, NULL, 1
      )
      `
    ).run({
      id,
      receiptNo,
      seasonId: season.id,
      date,
      dateKey,
      timeText,
      farmerId: farmer.id,
      farmerName: farmer.name,
      companyId: company.id,
      companyName: company.name,
      apricotTypeId: apricotType.id,
      apricotTypeName: apricotType.name,
      grossQuantityGram,
      crateCount,
      crateTareGram,
      quantityGram,
      unitPriceKurus,
      totalAmountKurus,
      note: optionalText(input.note),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    db.prepare(
      `
      UPDATE farmers
      SET total_gram = total_gram + @quantityGram,
          total_amount_kurus = total_amount_kurus + @totalAmountKurus,
          balance_kurus = balance_kurus + @totalAmountKurus,
          receipt_count = receipt_count + 1,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @farmerId
      `
    ).run({ quantityGram, totalAmountKurus, updatedAt: timestamp, farmerId: farmer.id });

    db.prepare(
      `
      UPDATE companies
      SET total_gram = total_gram + @quantityGram,
          total_amount_kurus = total_amount_kurus + @totalAmountKurus,
          balance_kurus = balance_kurus + @totalAmountKurus,
          receipt_count = receipt_count + 1,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @companyId
      `
    ).run({ quantityGram, totalAmountKurus, updatedAt: timestamp, companyId: company.id });

    db.prepare(
      `
      INSERT INTO daily_company_summaries (
        id, season_id, date_key, company_id, company_name, total_gram,
        total_amount_kurus, receipt_count, updated_at
      )
      VALUES (@id, @seasonId, @dateKey, @companyId, @companyName, @quantityGram, @totalAmountKurus, 1, @updatedAt)
      ON CONFLICT(season_id, date_key, company_id) DO UPDATE SET
        company_name = excluded.company_name,
        total_gram = total_gram + excluded.total_gram,
        total_amount_kurus = total_amount_kurus + excluded.total_amount_kurus,
        receipt_count = receipt_count + 1,
        updated_at = excluded.updated_at
      `
    ).run({
      id: randomUUID(),
      seasonId: season.id,
      dateKey,
      companyId: company.id,
      companyName: company.name,
      quantityGram,
      totalAmountKurus,
      updatedAt: timestamp
    });

    db.prepare(
      `
      INSERT INTO daily_type_summaries (
        id, season_id, date_key, apricot_type_id, apricot_type_name, total_gram,
        total_amount_kurus, receipt_count, updated_at
      )
      VALUES (@id, @seasonId, @dateKey, @apricotTypeId, @apricotTypeName, @quantityGram, @totalAmountKurus, 1, @updatedAt)
      ON CONFLICT(season_id, date_key, apricot_type_id) DO UPDATE SET
        apricot_type_name = excluded.apricot_type_name,
        total_gram = total_gram + excluded.total_gram,
        total_amount_kurus = total_amount_kurus + excluded.total_amount_kurus,
        receipt_count = receipt_count + 1,
        updated_at = excluded.updated_at
      `
    ).run({
      id: randomUUID(),
      seasonId: season.id,
      dateKey,
      apricotTypeId: apricotType.id,
      apricotTypeName: apricotType.name,
      quantityGram,
      totalAmountKurus,
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
      VALUES (@id, @seasonId, 0, 0, 0, 0, 0, 0, 0, 0, 0, @updatedAt)
      `
    ).run({ id: randomUUID(), seasonId: season.id, updatedAt: timestamp });

    db.prepare(
      `
      UPDATE season_summaries
      SET total_gram = total_gram + @quantityGram,
          total_amount_kurus = total_amount_kurus + @totalAmountKurus,
          receipt_count = receipt_count + 1,
          farmer_count = (SELECT COUNT(*) FROM farmers WHERE deleted_at IS NULL AND is_active = 1),
          company_count = (SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL AND is_active = 1),
          farmer_balance_total_kurus = (SELECT COALESCE(SUM(balance_kurus), 0) FROM farmers WHERE deleted_at IS NULL AND is_active = 1),
          company_balance_total_kurus = (SELECT COALESCE(SUM(balance_kurus), 0) FROM companies WHERE deleted_at IS NULL AND is_active = 1),
          updated_at = @updatedAt
      WHERE season_id = @seasonId
      `
    ).run({ quantityGram, totalAmountKurus, updatedAt: timestamp, seasonId: season.id });

    updateSeasonTotals(season.id, timestamp);

    setSetting('last_selected_company_id', company.id);
    setSetting('last_selected_apricot_type_id', apricotType.id);
    setSetting('last_unit_price_kurus', String(unitPriceKurus));

    const row = db
      .prepare(
        `
        SELECT id, receipt_no, season_id, date, date_key, time_text, farmer_id, farmer_name,
               company_id, company_name, apricot_type_id, apricot_type_name,
               gross_quantity_gram, crate_count, crate_tare_gram, quantity_gram,
               unit_price_kurus, total_amount_kurus, note, is_cancelled
        FROM purchase_receipts
        WHERE id = ?
        `
      )
      .get(id) as PurchaseReceiptRow;

    return mapReceipt(row);
  });

  return create();
}

export function cancelPurchaseReceipt(input: CancelInput): void {
  const db = getDatabase();
  const cancel = db.transaction(() => {
    const reason = requiredText(input.reason, 'İptal nedeni');
    const timestamp = nowIso();
    const receipt = db
      .prepare(
        `
        SELECT id, receipt_no, season_id, date, date_key, time_text, farmer_id, farmer_name,
               company_id, company_name, apricot_type_id, apricot_type_name,
               gross_quantity_gram, crate_count, crate_tare_gram, quantity_gram,
               unit_price_kurus, total_amount_kurus, note, is_cancelled
        FROM purchase_receipts
        WHERE id = ? AND deleted_at IS NULL
        `
      )
      .get(input.id) as PurchaseReceiptRow | undefined;

    if (!receipt) {
      throw new Error('Fiş bulunamadı.');
    }

    if (receipt.is_cancelled === 1) {
      throw new Error('Bu fiş zaten iptal edilmiş.');
    }

    db.prepare(
      `
      UPDATE purchase_receipts
      SET is_cancelled = 1,
          cancelled_at = @cancelledAt,
          cancel_reason = @cancelReason,
          updated_at = @updatedAt,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          version = version + 1
      WHERE id = @id
      `
    ).run({
      id: receipt.id,
      cancelledAt: timestamp,
      cancelReason: reason,
      updatedAt: timestamp
    });

    db.prepare(
      `
      UPDATE farmers
      SET total_gram = total_gram - @quantityGram,
          total_amount_kurus = total_amount_kurus - @totalAmountKurus,
          balance_kurus = balance_kurus - @totalAmountKurus,
          receipt_count = CASE WHEN receipt_count > 0 THEN receipt_count - 1 ELSE 0 END,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @farmerId
      `
    ).run({
      quantityGram: receipt.quantity_gram,
      totalAmountKurus: receipt.total_amount_kurus,
      updatedAt: timestamp,
      farmerId: receipt.farmer_id
    });

    db.prepare(
      `
      UPDATE companies
      SET total_gram = total_gram - @quantityGram,
          total_amount_kurus = total_amount_kurus - @totalAmountKurus,
          balance_kurus = balance_kurus - @totalAmountKurus,
          receipt_count = CASE WHEN receipt_count > 0 THEN receipt_count - 1 ELSE 0 END,
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          updated_at = @updatedAt,
          version = version + 1
      WHERE id = @companyId
      `
    ).run({
      quantityGram: receipt.quantity_gram,
      totalAmountKurus: receipt.total_amount_kurus,
      updatedAt: timestamp,
      companyId: receipt.company_id
    });

    db.prepare(
      `
      UPDATE daily_company_summaries
      SET total_gram = total_gram - @quantityGram,
          total_amount_kurus = total_amount_kurus - @totalAmountKurus,
          receipt_count = CASE WHEN receipt_count > 0 THEN receipt_count - 1 ELSE 0 END,
          updated_at = @updatedAt
      WHERE season_id = @seasonId AND date_key = @dateKey AND company_id = @companyId
      `
    ).run({
      quantityGram: receipt.quantity_gram,
      totalAmountKurus: receipt.total_amount_kurus,
      updatedAt: timestamp,
      seasonId: receipt.season_id,
      dateKey: receipt.date_key,
      companyId: receipt.company_id
    });

    db.prepare(
      `
      UPDATE daily_type_summaries
      SET total_gram = total_gram - @quantityGram,
          total_amount_kurus = total_amount_kurus - @totalAmountKurus,
          receipt_count = CASE WHEN receipt_count > 0 THEN receipt_count - 1 ELSE 0 END,
          updated_at = @updatedAt
      WHERE season_id = @seasonId AND date_key = @dateKey AND apricot_type_id = @apricotTypeId
      `
    ).run({
      quantityGram: receipt.quantity_gram,
      totalAmountKurus: receipt.total_amount_kurus,
      updatedAt: timestamp,
      seasonId: receipt.season_id,
      dateKey: receipt.date_key,
      apricotTypeId: receipt.apricot_type_id
    });

    db.prepare(
      `
      UPDATE season_summaries
      SET total_gram = total_gram - @quantityGram,
          total_amount_kurus = total_amount_kurus - @totalAmountKurus,
          receipt_count = CASE WHEN receipt_count > 0 THEN receipt_count - 1 ELSE 0 END,
          updated_at = @updatedAt
      WHERE season_id = @seasonId
      `
    ).run({
      quantityGram: receipt.quantity_gram,
      totalAmountKurus: receipt.total_amount_kurus,
      updatedAt: timestamp,
      seasonId: receipt.season_id
    });

    updateSeasonTotals(receipt.season_id, timestamp);
  });

  cancel();
}
