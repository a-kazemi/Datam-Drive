import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";
import fs from "fs";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error("DB not initialized — call initDb() first");
  return db;
}

export function initDb(): Database.Database {
  const dataDir = path.join(app.getPath("userData"), "DatamDrive");
  fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(path.join(dataDir, "state.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // T6: local_path index; T9: server_url UNIQUE nullable, local_path UNIQUE; T13: local_root UNIQUE
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_items (
      id               INTEGER PRIMARY KEY,
      server_url       TEXT UNIQUE,
      local_path       TEXT NOT NULL UNIQUE,
      sp_item_id       INTEGER,
      etag             TEXT,
      sp_version       INTEGER,
      last_synced_at   INTEGER,
      local_mtime      INTEGER,
      local_size       INTEGER,
      dirty            INTEGER NOT NULL DEFAULT 0,
      permission_level TEXT NOT NULL DEFAULT 'rw'
    );

    CREATE INDEX IF NOT EXISTS idx_sync_items_local_path ON sync_items(local_path);

    CREATE TABLE IF NOT EXISTS libraries (
      id               INTEGER PRIMARY KEY,
      site_url         TEXT NOT NULL,
      list_id          TEXT NOT NULL UNIQUE,
      title            TEXT NOT NULL,
      local_root       TEXT NOT NULL UNIQUE,
      change_token     TEXT,
      last_polled      INTEGER,
      permission_level TEXT NOT NULL DEFAULT 'rw',
      status           TEXT NOT NULL DEFAULT 'idle'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  const MB50 = String(50 * 1024 * 1024);
  insert.run("pollIntervalMs", "30000");
  insert.run("maxFileSizeBytes", MB50);
  insert.run("autoUpdate", "false");
  insert.run("updateFeedUrl", "https://github.com/datam-drive");
  insert.run("paused", "false");

  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
