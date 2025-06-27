-- Initial schema migration for Claude-Flow SQLite database
-- Version: 001
-- Date: 2025-01-21

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Agent Management
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('researcher', 'developer', 'analyzer', 'coordinator', 'reviewer')),
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('idle', 'busy', 'failed', 'completed', 'active')),
    capabilities TEXT, -- JSON array
    system_prompt TEXT,
    max_concurrent_tasks INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);

-- Agent Metrics (separate for performance)
CREATE TABLE IF NOT EXISTS agent_metrics (
    agent_id TEXT PRIMARY KEY,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Task Management
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'assigned', 'in_progress', 'completed', 'failed')),
    priority INTEGER DEFAULT 1,
    dependencies TEXT, -- JSON array
    metadata TEXT, -- JSON object
    assigned_agent TEXT,
    progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    timeout_ms INTEGER DEFAULT 300000,
    FOREIGN KEY (assigned_agent) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent ON tasks(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_priority_status ON tasks(priority DESC, status);

-- Swarm Memory
CREATE TABLE IF NOT EXISTS swarm_memory_entries (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('knowledge', 'result', 'state', 'communication', 'error')),
    content TEXT NOT NULL, -- JSON or text
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    task_id TEXT,
    objective_id TEXT,
    tags TEXT, -- JSON array
    priority INTEGER DEFAULT 1,
    share_level TEXT DEFAULT 'team' CHECK(share_level IN ('private', 'team', 'public')),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_agent_id ON swarm_memory_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON swarm_memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON swarm_memory_entries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_memory_tags ON swarm_memory_entries(tags); -- For JSON queries
CREATE INDEX IF NOT EXISTS idx_memory_share_level ON swarm_memory_entries(share_level);

-- Knowledge Bases
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    domain TEXT,
    expertise TEXT, -- JSON array
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_base_entries (
    kb_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    PRIMARY KEY (kb_id, entry_id),
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES swarm_memory_entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_base_contributors (
    kb_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    contributed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kb_id, agent_id),
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Objectives
CREATE TABLE IF NOT EXISTS objectives (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    strategy TEXT CHECK(strategy IN ('auto', 'research', 'development', 'analysis')),
    status TEXT NOT NULL CHECK(status IN ('planning', 'executing', 'completed', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS objective_tasks (
    objective_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    sequence_order INTEGER NOT NULL,
    PRIMARY KEY (objective_id, task_id),
    FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Configuration
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL, -- JSON value
    category TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_config_category ON config(category);

-- Projects (Enterprise)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT CHECK(type IN ('web-app', 'api', 'microservice', 'infrastructure', 'research', 'migration', 'custom')),
    status TEXT CHECK(status IN ('planning', 'active', 'on-hold', 'completed', 'cancelled')),
    priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    owner TEXT NOT NULL,
    stakeholders TEXT, -- JSON array
    budget_total REAL DEFAULT 0,
    budget_spent REAL DEFAULT 0,
    budget_currency TEXT DEFAULT 'USD',
    planned_start DATE,
    planned_end DATE,
    actual_start DATE,
    actual_end DATE,
    tags TEXT, -- JSON array
    metadata TEXT, -- JSON object
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);

-- Project Phases
CREATE TABLE IF NOT EXISTS project_phases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT CHECK(status IN ('planned', 'in-progress', 'completed', 'blocked', 'cancelled')),
    start_date DATE,
    end_date DATE,
    estimated_duration_hours INTEGER,
    actual_duration_hours INTEGER,
    dependencies TEXT, -- JSON array
    assigned_team TEXT, -- JSON array
    deliverables TEXT, -- JSON array
    completion_percentage INTEGER DEFAULT 0 CHECK(completion_percentage >= 0 AND completion_percentage <= 100),
    test_coverage REAL DEFAULT 0,
    code_quality REAL DEFAULT 0,
    documentation_score REAL DEFAULT 0,
    security_score REAL DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_phases_project_id ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_phases_status ON project_phases(status);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT, -- JSON object
    ip_address TEXT,
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);

-- Message Bus
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    receivers TEXT NOT NULL, -- JSON array
    content TEXT NOT NULL, -- JSON or text
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'critical')),
    reliability TEXT DEFAULT 'best-effort' CHECK(reliability IN ('best-effort', 'at-least-once', 'exactly-once')),
    correlation_id TEXT,
    reply_to TEXT,
    ttl_ms INTEGER,
    compressed BOOLEAN DEFAULT 0,
    encrypted BOOLEAN DEFAULT 0,
    size_bytes INTEGER NOT NULL,
    content_type TEXT DEFAULT 'application/json',
    route TEXT, -- JSON array
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at);

-- Message Acknowledgments
CREATE TABLE IF NOT EXISTS message_acknowledgments (
    message_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('acknowledged', 'rejected')),
    acknowledged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, agent_id),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_memory_agent_type_timestamp ON swarm_memory_entries(agent_id, type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status_updated ON projects(status, updated_at DESC);

-- Full-text search for memory content
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    entry_id UNINDEXED,
    content,
    tags
);

-- Triggers for FTS maintenance
CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON swarm_memory_entries
BEGIN
    INSERT INTO memory_fts(entry_id, content, tags) 
    VALUES (NEW.id, NEW.content, NEW.tags);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON swarm_memory_entries
BEGIN
    UPDATE memory_fts 
    SET content = NEW.content, tags = NEW.tags 
    WHERE entry_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON swarm_memory_entries
BEGIN
    DELETE FROM memory_fts WHERE entry_id = OLD.id;
END;

-- Update timestamp triggers
CREATE TRIGGER IF NOT EXISTS update_agent_timestamp AFTER UPDATE ON agents
BEGIN
    UPDATE agents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_project_timestamp AFTER UPDATE ON projects
BEGIN
    UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Database health view
CREATE VIEW IF NOT EXISTS db_health AS
SELECT 
    (SELECT COUNT(*) FROM agents WHERE status = 'active') as active_agents,
    (SELECT COUNT(*) FROM tasks WHERE status IN ('pending', 'in_progress')) as active_tasks,
    (SELECT COUNT(*) FROM swarm_memory_entries WHERE timestamp > datetime('now', '-1 hour')) as recent_memories,
    (SELECT COUNT(*) FROM messages WHERE created_at > datetime('now', '-5 minutes')) as recent_messages,
    (SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()) as db_size_bytes;

-- Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Record this migration
INSERT INTO schema_migrations (version, description) 
VALUES ('001', 'Initial schema with all core tables');