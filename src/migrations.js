import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, execSql, run } from './db.js';

const migrationsDirectory = path.resolve(process.cwd(), 'migrations');
const migrationsTable = 'schema_migrations';

function normalizeMigrationSql(sql) {
  return sql.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toChecksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

/**
 * Returns sorted list of migration files from /migrations.
 */
async function readMigrationFiles() {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  const migrationFiles = [];
  const seenVersions = new Set();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/^[0-9]+_.*\.sql$/.test(entry.name)) {
      continue;
    }

    const migrationPath = path.join(migrationsDirectory, entry.name);
    const sql = await fs.readFile(migrationPath, 'utf8');
    const normalizedSql = normalizeMigrationSql(sql);
    const version = entry.name.split('_')[0];
    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version detected: ${version}`);
    }
    seenVersions.add(version);

    const checksum = toChecksum(normalizedSql);
    const windowsChecksum = toChecksum(normalizedSql.replace(/\n/g, '\r\n'));

    migrationFiles.push({
      version,
      filename: entry.name,
      path: migrationPath,
      sql: normalizedSql,
      checksum,
      alternateChecksum: windowsChecksum,
    });
  }

  return migrationFiles.sort((a, b) => {
    const versionA = Number(a.version);
    const versionB = Number(b.version);
    if (versionA !== versionB) {
      return versionA - versionB;
    }

    return a.filename.localeCompare(b.filename);
  });
}

/**
 * Ensures migration history table exists.
 */
async function initMigrationsTable(db) {
  await execSql(
    db,
    `
    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  );
}

/**
 * Loads already applied migrations from DB.
 */
async function getAppliedMigrations(db) {
  const rows = await all(db, `SELECT version, filename, checksum FROM ${migrationsTable} ORDER BY version`);
  const map = new Map();

  for (const row of rows) {
    map.set(row.version, row);
  }

  return map;
}

/**
 * Apply a single migration in a transaction.
 */
async function applyMigration(db, migration) {
  await execSql(db, 'BEGIN');
  try {
    await execSql(db, migration.sql);
    await run(db, `INSERT INTO ${migrationsTable}(version, filename, checksum) VALUES (?, ?, ?)`, [
      migration.version,
      migration.filename,
      migration.checksum,
    ]);
    await execSql(db, 'COMMIT');
  } catch (error) {
    await execSql(db, 'ROLLBACK');
    throw error;
  }
}

/**
 * Returns migration status and pending list.
 */
export async function status(db) {
  await initMigrationsTable(db);
  const files = await readMigrationFiles();
  const applied = await getAppliedMigrations(db);

  const result = [];
  for (const migration of files) {
    const appliedItem = applied.get(migration.version);
    result.push({
      version: migration.version,
      filename: migration.filename,
      checksum: migration.checksum,
      state: appliedItem ? 'applied' : 'pending',
      appliedChecksumMismatch:
        Boolean(appliedItem && appliedItem.checksum !== migration.checksum),
    });
  }

  return result;
}

/**
 * Apply all pending migrations.
 */
export async function migrate(db) {
  await initMigrationsTable(db);
  const files = await readMigrationFiles();
  const applied = await getAppliedMigrations(db);
  const skipped = [];
  const executed = [];

  for (const migration of files) {
    const appliedItem = applied.get(migration.version);
    if (appliedItem) {
      const checksumMatch = appliedItem.checksum === migration.checksum;
      const alternateMatch = appliedItem.checksum === migration.alternateChecksum;
      if (!checksumMatch && !alternateMatch) {
        throw new Error(
          `Migration ${migration.filename} already applied, but checksum mismatch. ` +
            `Has ${appliedItem.checksum}, expected ${migration.checksum}.`,
        );
      }
      if (!checksumMatch && alternateMatch) {
        await run(
          db,
          `UPDATE ${migrationsTable} SET checksum = ? WHERE version = ?`,
          [migration.checksum, migration.version],
        );
      }

      skipped.push(migration.filename);
      continue;
    }

    await applyMigration(db, migration);
    executed.push(migration.filename);
    applied.set(migration.version, {
      version: migration.version,
      filename: migration.filename,
      checksum: migration.checksum,
    });
    console.log(`Applied migration ${migration.filename}`);
  }

  return { executed, skipped };
}
