import type { Migration } from '.';

export const farmerNicknameField: Migration = {
  id: '003_farmer_nickname_field',
  sql: `
    ALTER TABLE farmers ADD COLUMN nickname TEXT;

    DROP INDEX IF EXISTS idx_farmers_search;
    CREATE INDEX IF NOT EXISTS idx_farmers_search ON farmers(name, nickname, village, phone);
  `
};
