/**
 * 版本化 migration。index i 對應版本 i+1，只能在尾端追加、不可改動已上線的項目。
 * 用 TS 字串而非 .sql 檔：esbuild 把 backend 打包成單一 bundle，讀不到旁邊的檔案。
 */
export const MIGRATIONS: ReadonlyArray<string> = [
  `
  CREATE TABLE lesson_plans (
    id             TEXT PRIMARY KEY,
    teacher_uid    TEXT NOT NULL,
    institution_id TEXT,
    scene_id       TEXT NOT NULL,
    topic          TEXT NOT NULL,
    level          TEXT NOT NULL,
    title          TEXT NOT NULL,
    plan_json      TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX idx_lesson_plans_teacher ON lesson_plans (teacher_uid, updated_at DESC);
  CREATE TABLE lesson_tasks (
    id           TEXT PRIMARY KEY,
    plan_id      TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
    module_id    TEXT NOT NULL,
    module_label TEXT NOT NULL,
    sort_order   INTEGER NOT NULL,
    label        TEXT NOT NULL,
    hint_json    TEXT NOT NULL
  );
  CREATE INDEX idx_lesson_tasks_plan ON lesson_tasks (plan_id, sort_order);
  `,
]
