import { getDatabase } from './connection';
import { migrations } from './migrations';

interface AppliedMigrationRow {
  id: string;
}

export function runMigrations(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT id FROM schema_migrations ORDER BY id ASC')
    .all() as AppliedMigrationRow[];
  const applied = new Set(appliedRows.map((row) => row.id));

  const applyMigration = db.transaction((migration: (typeof migrations)[number]) => {
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
      migration.id,
      new Date().toISOString()
    );
  });

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      applyMigration(migration);
    }
  }
}
