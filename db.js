const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Initialize Database connection
const dbPath = path.resolve(__dirname, "attendance_v2.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
  } else {
    console.log("✅ Connected to the SQLite database.");
  }
});

// Setup tables
db.serialize(() => {
  // Sessions Table
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name TEXT NOT NULL,
      teacher_username TEXT NOT NULL,
      token TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  // Safely add columns if they don't exist (for existing databases)
  db.run("ALTER TABLE sessions ADD COLUMN is_active INTEGER DEFAULT 0", (err) => {
    // Ignore error if column already exists
  });
  db.run("ALTER TABLE sessions ADD COLUMN teacher_username TEXT", (err) => {
    // Ignore error if column already exists
  });

  // Attendance Table
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      timestamp INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(session_id, student_name)
    )
  `);

  // If the old table had 'marked_at', we shouldn't necessarily rename it unless we want to migrate,
  // but let's assume we are starting fresh or we can just add timestamp.
  // Actually, let's rename the column if it was marked_at, but SQLite doesn't support easy column renames in old versions.
  // We'll rely on the new table creation if it's a fresh DB. 
  // For safety, let's add timestamp column just in case.
  db.run("ALTER TABLE attendance ADD COLUMN timestamp INTEGER DEFAULT (strftime('%s','now'))", (err) => {});
});

module.exports = db;
