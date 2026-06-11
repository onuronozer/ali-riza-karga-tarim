import type { Migration } from '.';

export const purchaseReceiptTareFields: Migration = {
  id: '002_purchase_receipt_tare_fields',
  sql: `
    ALTER TABLE purchase_receipts ADD COLUMN gross_quantity_gram INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE purchase_receipts ADD COLUMN crate_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE purchase_receipts ADD COLUMN crate_tare_gram INTEGER NOT NULL DEFAULT 0;

    UPDATE purchase_receipts
    SET gross_quantity_gram = quantity_gram
    WHERE gross_quantity_gram = 0;
  `
};
