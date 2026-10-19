import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MigrationFileError,
  loadMigrationFiles,
} from '../src/shared/db/migrate';

const temporaryDirectories: string[] = [];

async function makeMigrationDir(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'paike-migrations-'));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(files).map(([filename, content]) => writeFile(path.join(directory, filename), content)),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('migration discovery', () => {
  it('sorts by filename and computes stable checksums', async () => {
    const directory = await makeMigrationDir({
      '0002_second.sql': 'SELECT 2;\n',
      '0001_first.sql': 'SELECT 1;\n',
    });

    const migrations = await loadMigrationFiles(directory);
    expect(migrations.map((migration) => migration.filename)).toEqual([
      '0001_first.sql',
      '0002_second.sql',
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0]?.checksum).not.toBe(migrations[1]?.checksum);
  });

  it('rejects malformed names', async () => {
    const directory = await makeMigrationDir({ '1_bad.sql': 'SELECT 1;' });
    await expect(loadMigrationFiles(directory)).rejects.toBeInstanceOf(MigrationFileError);
  });

  it('allows card-reserved sequence gaps while keeping order', async () => {
    const directory = await makeMigrationDir({
      '0011_later.sql': 'SELECT 11;',
      '0001_first.sql': 'SELECT 1;',
      '0010_domain.sql': 'SELECT 10;',
    });
    const migrations = await loadMigrationFiles(directory);
    expect(migrations.map((migration) => migration.filename)).toEqual([
      '0001_first.sql',
      '0010_domain.sql',
      '0011_later.sql',
    ]);
  });

  it('requires numbering to start at 0001', async () => {
    const directory = await makeMigrationDir({
      '0002_second.sql': 'SELECT 2;',
    });
    await expect(loadMigrationFiles(directory)).rejects.toThrow(/从 0001 开始/);
  });
});
