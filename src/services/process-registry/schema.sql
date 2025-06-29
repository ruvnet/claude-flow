-- Process Registry SQLite Schema
-- Central database for tracking all Claude-Flow processes

-- Main process table
CREATE TABLE IF NOT EXISTS processes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('swarm', 'agent', 'task', 'service')),
    pid INTEGER NOT NULL,
    parent_id TEXT,
    start_time INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('starting', 'running', 'stopping', 'stopped', 'failed', 'unresponsive')),
    command TEXT NOT NULL, -- JSON array
    environment TEXT NOT NULL, -- JSON object
    resources TEXT NOT NULL, -- JSON object
    health_check TEXT NOT NULL, -- JSON object
    metadata TEXT, -- JSON object
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (parent_id) REFERENCES processes(id) ON DELETE SET NULL
);

-- Health tracking table
CREATE TABLE IF NOT EXISTS health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('healthy', 'unhealthy', 'unknown')),
    consecutive_failures INTEGER DEFAULT 0,
    diagnostics TEXT, -- JSON object
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE
);

-- Process metrics table
CREATE TABLE IF NOT EXISTS process_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    memory INTEGER NOT NULL,
    cpu REAL NOT NULL,
    uptime INTEGER NOT NULL,
    error_count INTEGER DEFAULT 0,
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE
);

-- Registry events table for audit trail
CREATE TABLE IF NOT EXISTS registry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id TEXT,
    event_type TEXT NOT NULL CHECK(event_type IN ('register', 'unregister', 'heartbeat', 'terminate', 'restart', 'status_change')),
    timestamp INTEGER NOT NULL,
    details TEXT, -- JSON object
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_processes_status ON processes(status);
CREATE INDEX IF NOT EXISTS idx_processes_type ON processes(type);
CREATE INDEX IF NOT EXISTS idx_processes_parent_id ON processes(parent_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_process_id ON health_checks(process_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_timestamp ON health_checks(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_process_id ON process_metrics(process_id);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON process_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_process_id ON registry_events(process_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON registry_events(timestamp);

-- Triggers for updated_at
CREATE TRIGGER IF NOT EXISTS update_processes_timestamp 
AFTER UPDATE ON processes
BEGIN
    UPDATE processes SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;