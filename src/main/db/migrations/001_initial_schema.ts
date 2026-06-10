import type { Migration } from '.';

export const initialSchema: Migration = {
  id: '001_initial_schema',
  sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      device_code TEXT NOT NULL UNIQUE,
      device_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      name TEXT NOT NULL,
      year INTEGER NOT NULL,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
        CHECK (sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'synced', 'sync_error')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS farmers (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      name TEXT NOT NULL,
      phone TEXT,
      village TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      total_gram INTEGER NOT NULL DEFAULT 0,
      total_amount_kurus INTEGER NOT NULL DEFAULT 0,
      paid_amount_kurus INTEGER NOT NULL DEFAULT 0,
      balance_kurus INTEGER NOT NULL DEFAULT 0,
      receipt_count INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
        CHECK (sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'synced', 'sync_error')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      name TEXT NOT NULL,
      authorized_person TEXT,
      phone TEXT,
      city TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      total_gram INTEGER NOT NULL DEFAULT 0,
      total_amount_kurus INTEGER NOT NULL DEFAULT 0,
      collected_amount_kurus INTEGER NOT NULL DEFAULT 0,
      balance_kurus INTEGER NOT NULL DEFAULT 0,
      receipt_count INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
        CHECK (sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'synced', 'sync_error')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS apricot_types (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
        CHECK (sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'synced', 'sync_error')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS purchase_receipts (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      receipt_no TEXT NOT NULL UNIQUE,
      season_id TEXT NOT NULL,
      date TEXT NOT NULL,
      date_key TEXT NOT NULL,
      time_text TEXT NOT NULL,
      farmer_id TEXT NOT NULL,
      farmer_name TEXT NOT NULL,
      company_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      apricot_type_id TEXT NOT NULL,
      apricot_type_name TEXT NOT NULL,
      quantity_gram INTEGER NOT NULL,
      unit_price_kurus INTEGER NOT NULL,
      total_amount_kurus INTEGER NOT NULL,
      note TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT,
      cancel_reason TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
        CHECK (sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'synced', 'sync_error')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (farmer_id) REFERENCES farmers(id),
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (apricot_type_id) REFERENCES apricot_types(id)
    );

    CREATE TABLE IF NOT EXISTS farmer_payments (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      season_id TEXT NOT NULL,
      farmer_id TEXT NOT NULL,
      farmer_name TEXT NOT NULL,
      date TEXT NOT NULL,
      date_key TEXT NOT NULL,
      amount_kurus INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank', 'other')),
      note TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT,
      cancel_reason TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
        CHECK (sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'synced', 'sync_error')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (farmer_id) REFERENCES farmers(id)
    );

    CREATE TABLE IF NOT EXISTS company_payments (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      season_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      date TEXT NOT NULL,
      date_key TEXT NOT NULL,
      amount_kurus INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank', 'other')),
      note TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT,
      cancel_reason TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
        CHECK (sync_status IN ('pending_create', 'pending_update', 'pending_delete', 'synced', 'sync_error')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS daily_company_summaries (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      company_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      total_gram INTEGER NOT NULL DEFAULT 0,
      total_amount_kurus INTEGER NOT NULL DEFAULT 0,
      receipt_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (season_id, date_key, company_id),
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS daily_type_summaries (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      apricot_type_id TEXT NOT NULL,
      apricot_type_name TEXT NOT NULL,
      total_gram INTEGER NOT NULL DEFAULT 0,
      total_amount_kurus INTEGER NOT NULL DEFAULT 0,
      receipt_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (season_id, date_key, apricot_type_id),
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (apricot_type_id) REFERENCES apricot_types(id)
    );

    CREATE TABLE IF NOT EXISTS season_summaries (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL UNIQUE,
      total_gram INTEGER NOT NULL DEFAULT 0,
      total_amount_kurus INTEGER NOT NULL DEFAULT 0,
      receipt_count INTEGER NOT NULL DEFAULT 0,
      farmer_count INTEGER NOT NULL DEFAULT 0,
      company_count INTEGER NOT NULL DEFAULT 0,
      paid_to_farmers_kurus INTEGER NOT NULL DEFAULT 0,
      collected_from_companies_kurus INTEGER NOT NULL DEFAULT 0,
      farmer_balance_total_kurus INTEGER NOT NULL DEFAULT 0,
      company_balance_total_kurus INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS receipt_number_counters (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      device_code TEXT NOT NULL,
      last_number INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (date_key, device_code)
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error')),
      message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_farmers_search ON farmers(name, village, phone);
    CREATE INDEX IF NOT EXISTS idx_companies_search ON companies(name, city, phone);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipts_season_date ON purchase_receipts(season_id, date_key);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipts_farmer_date ON purchase_receipts(farmer_id, date_key);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipts_company_date ON purchase_receipts(company_id, date_key);
    CREATE INDEX IF NOT EXISTS idx_purchase_receipts_sync ON purchase_receipts(sync_status);
    CREATE INDEX IF NOT EXISTS idx_farmer_payments_farmer_date ON farmer_payments(farmer_id, date_key);
    CREATE INDEX IF NOT EXISTS idx_company_payments_company_date ON company_payments(company_id, date_key);
    CREATE INDEX IF NOT EXISTS idx_farmer_payments_sync ON farmer_payments(sync_status);
    CREATE INDEX IF NOT EXISTS idx_company_payments_sync ON company_payments(sync_status);
    CREATE INDEX IF NOT EXISTS idx_seasons_sync ON seasons(sync_status);
    CREATE INDEX IF NOT EXISTS idx_farmers_sync ON farmers(sync_status);
    CREATE INDEX IF NOT EXISTS idx_companies_sync ON companies(sync_status);
    CREATE INDEX IF NOT EXISTS idx_apricot_types_sync ON apricot_types(sync_status);

    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES
      ('device_id', NULL, CURRENT_TIMESTAMP),
      ('device_code', NULL, CURRENT_TIMESTAMP),
      ('device_name', NULL, CURRENT_TIMESTAMP),
      ('last_sync_at', NULL, CURRENT_TIMESTAMP);
  `
};
