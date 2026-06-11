import { initialSchema } from './001_initial_schema';
import { purchaseReceiptTareFields } from './002_purchase_receipt_tare_fields';

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [initialSchema, purchaseReceiptTareFields];
