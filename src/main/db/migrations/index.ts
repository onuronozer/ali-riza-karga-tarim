import { initialSchema } from './001_initial_schema';
import { purchaseReceiptTareFields } from './002_purchase_receipt_tare_fields';
import { farmerNicknameField } from './003_farmer_nickname_field';

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [initialSchema, purchaseReceiptTareFields, farmerNicknameField];
