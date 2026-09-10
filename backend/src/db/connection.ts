import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { MIGRATIONS } from './migrations.js'

/** 開啟（必要時建立）SQLite 檔案並套用所有未執行的 migration。傳 ':memory:' 供測試。 */
export function openDatabase(filePath: string): DatabaseSync {
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  let current = row.v ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i])
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    current = i + 1
  }
  return current
}
