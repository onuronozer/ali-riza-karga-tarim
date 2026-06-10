import { initialSchema } from './001_initial_schema';

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [initialSchema];
