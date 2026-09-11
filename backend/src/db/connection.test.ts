import { describe, it, expect } from 'vitest'
import { openDatabase, migrate } from './connection.js'
import { MIGRATIONS } from './migrations.js'

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
    .map(r => r.name)
}

describe('openDatabase / migrate', () => {
  it('creates lesson_plans and lesson_tasks tables', () => {
    const db = openDatabase(':memory:')
    expect(tableNames(db)).toEqual(expect.arrayContaining(['lesson_plans', 'lesson_tasks', 'schema_version']))
  })

  it('is idempotent: second migrate keeps the same version', () => {
    const db = openDatabase(':memory:')
    const v1 = migrate(db)
    const v2 = migrate(db)
    expect(v1).toBe(MIGRATIONS.length)
    expect(v2).toBe(v1)
    const rows = db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c: number }
    expect(rows.c).toBe(MIGRATIONS.length)
  })

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db.prepare(
        `INSERT INTO lesson_tasks (id, plan_id, module_id, module_label, sort_order, label, hint_json)
         VALUES ('t1', 'missing-plan', 'm1', 'Price', 0, 'Ask', '{}')`,
      ).run(),
    ).toThrow(/FOREIGN KEY/i)
  })
})
