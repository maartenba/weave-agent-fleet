/**
 * Database module — server-side SQLite singleton via better-sqlite3.
 *
 * The database file is stored at ~/.weave/fleet.db by default.
 * Override with the WEAVE_DB_PATH environment variable.
 *
 * Uses WAL mode for concurrent read performance and a busy_timeout
 * to handle write contention in Next.js dev mode.
 */

import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { dirname, resolve } from "path";

function getDbPath(): string {
  if (process.env.WEAVE_DB_PATH) {
    return resolve(process.env.WEAVE_DB_PATH);
  }
  return resolve(homedir(), ".weave", "fleet.db");
}

let _db: Database.Database | null = null;

/**
 * Returns the singleton database instance.
 * Creates the database file and schema on first call.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath();

  // Ensure the parent directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Enable WAL mode for concurrent reads + write contention handling
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      source_directory TEXT,
      isolation_strategy TEXT NOT NULL DEFAULT 'existing',
      branch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cleaned_up_at TEXT
    );

    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      port INTEGER NOT NULL,
      pid INTEGER,
      directory TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      instance_id TEXT NOT NULL REFERENCES instances(id),
      opencode_session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      status TEXT NOT NULL DEFAULT 'active',
      directory TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT
    );
  `);

  _db = db;
  return db;
}

/**
 * Reset the database for tests — closes the connection and deletes the file.
 * Only use in test environments.
 */
export function _resetDbForTests(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  const dbPath = getDbPath();
  rmSync(dbPath, { force: true });
}
