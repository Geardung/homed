import 'dotenv/config';
import { close, createDatabase } from './db.js';
import { migrate, status as migrationStatus } from './migrations.js';

const { DATABASE_PATH = './homed.sqlite' } = process.env;

const command = process.argv[2];

const db = await createDatabase(DATABASE_PATH);
let exitCode = 0;

try {
  if (command === 'status') {
    const rows = await migrationStatus(db);
    for (const row of rows) {
      const statusValue = row.state === 'applied' ? 'ok' : 'pending';
      const mismatch = row.appliedChecksumMismatch ? ' [checksum mismatch]' : '';
      console.log(`${row.version} ${row.filename} - ${statusValue}${mismatch}`);
    }
    exitCode = 0;
    console.log(`Pending: ${rows.filter((item) => item.state === 'pending').length}`);
  } else {
    const result = await migrate(db);
    if (result.executed.length === 0) {
      console.log('Database already up to date');
      exitCode = 0;
    } else {
      console.log('Applied migrations:', result.executed.join(', '));
    }
  }
} catch (error) {
  console.error('Migration failed:', error.message);
  exitCode = 1;
} finally {
  await close(db);
}

process.exit(exitCode);
