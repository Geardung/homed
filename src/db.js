import sqlite3 from 'sqlite3';
import path from 'node:path';

const { Database } = sqlite3;

/**
 * Create or open SQLite database file.
 */
export async function createDatabase(databasePath = './homed.sqlite') {
  const absolutePath = path.resolve(process.cwd(), databasePath);
  const db = new Database(absolutePath);
  await execSql(db, 'PRAGMA foreign_keys = ON');
  return db;
}

/**
 * Execute statement that does not return rows.
 */
export function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve(this);
    });
  });
}

/**
 * Execute statement and return a single row.
 */
export function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

/**
 * Execute statement and return all rows.
 */
export function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

/**
 * Execute SQL string that can contain multiple statements.
 */
export function execSql(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

/**
 * Close database connection.
 */
export function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
