-- Hive Mind SQLite Database Schema
-- Collective intelligence and swarm coordination

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Swarms table: Core swarm configurations
CREATE TABLE IF NOT EXISTS swarms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    topology TEXT NOT NULL CHECK (topology IN ('mesh', 'hierarchical', 'ring', 'star')),
    queen_mode TEXT NOT NULL CHECK (queen_mode IN ('centralized', 'distributed')),
    max_agents INTEGER NOT NULL DEFAULT 8,
    consensus_threshold REAL NOT NULL DEFAULT 0.66,
    memory_ttl INTEGER NOT NULL DEFAULT 86400,
    config TEXT NOT NULL, -- JSON configuration
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived'))
);

-- Agents table: Individual agents in swarms
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    swarm_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN (
        'coordinator', 'researcher', 'coder', 'analyst', 'architect',
        'tester', 'reviewer', 'optimizer', 'documenter', 'monitor', 'specialist'
    )),
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'active', 'error', 'offline')),
    capabilities TEXT NOT NULL, -- JSON array of capabilities
    current_task_id TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMP,
    metadata TEXT, -- JSON metadata
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE,
    FOREIGN KEY (current_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Tasks table: Tasks submitted to swarm
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    swarm_id TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    strategy TEXT NOT NULL DEFAULT 'adaptive' CHECK (strategy IN ('parallel', 'sequential', 'adaptive', 'consensus')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    result TEXT, -- JSON result data
    error TEXT,
    dependencies TEXT, -- JSON array of task IDs
    assigned_agents TEXT, -- JSON array of agent IDs
    require_consensus BOOLEAN NOT NULL DEFAULT 0,
    consensus_achieved BOOLEAN,
    max_agents INTEGER NOT NULL DEFAULT 3,
    required_capabilities TEXT, -- JSON array
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    metadata TEXT, -- JSON metadata
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE
);

-- Memory table: Persistent collective memory
CREATE TABLE IF NOT EXISTS memory (
    key TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'default',
    value TEXT NOT NULL, -- JSON or plain text
    ttl INTEGER, -- Time to live in seconds
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    metadata TEXT, -- JSON metadata
    PRIMARY KEY (key, namespace)
);

-- Communications table: Inter-agent messaging
CREATE TABLE IF NOT EXISTS communications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT,
    swarm_id TEXT NOT NULL,
    message_type TEXT NOT NULL CHECK (message_type IN ('direct', 'broadcast', 'consensus', 'query', 'response', 'notification')),
    content TEXT NOT NULL, -- JSON message content
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    requires_response BOOLEAN NOT NULL DEFAULT 0,
    response_to_id INTEGER,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    metadata TEXT, -- JSON metadata
    FOREIGN KEY (from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (to_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE,
    FOREIGN KEY (response_to_id) REFERENCES communications(id) ON DELETE SET NULL
);

-- Consensus table: Consensus decision tracking
CREATE TABLE IF NOT EXISTS consensus (
    id TEXT PRIMARY KEY,
    swarm_id TEXT NOT NULL,
    task_id TEXT,
    proposal TEXT NOT NULL, -- JSON proposal
    required_threshold REAL NOT NULL,
    current_votes INTEGER NOT NULL DEFAULT 0,
    total_voters INTEGER NOT NULL DEFAULT 0,
    votes TEXT NOT NULL DEFAULT '{}', -- JSON object: {agent_id: {vote: boolean, reason: string}}
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'achieved', 'failed', 'timeout')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deadline_at TIMESTAMP,
    completed_at TIMESTAMP,
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    swarm_id TEXT NOT NULL,
    agent_id TEXT,
    metric_type TEXT NOT NULL,
    metric_value REAL NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT, -- JSON metadata
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Neural patterns table: Learned patterns and behaviors
CREATE TABLE IF NOT EXISTS neural_patterns (
    id TEXT PRIMARY KEY,
    swarm_id TEXT NOT NULL,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('coordination', 'optimization', 'prediction', 'behavior')),
    pattern_data TEXT NOT NULL, -- JSON encoded pattern
    confidence REAL NOT NULL DEFAULT 0.0,
    usage_count INTEGER NOT NULL DEFAULT 0,
    success_rate REAL NOT NULL DEFAULT 0.0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP,
    metadata TEXT, -- JSON metadata
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE
);

-- Session history table: Track swarm sessions
CREATE TABLE IF NOT EXISTS session_history (
    id TEXT PRIMARY KEY,
    swarm_id TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    tasks_failed INTEGER NOT NULL DEFAULT 0,
    total_messages INTEGER NOT NULL DEFAULT 0,
    avg_task_duration REAL,
    session_data TEXT, -- JSON session summary
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_agents_swarm ON agents(swarm_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_type ON agents(type);
CREATE INDEX idx_tasks_swarm ON tasks(swarm_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_memory_namespace ON memory(namespace);
CREATE INDEX idx_memory_expires ON memory(expires_at);
CREATE INDEX idx_communications_swarm ON communications(swarm_id);
CREATE INDEX idx_communications_timestamp ON communications(timestamp);
CREATE INDEX idx_communications_from ON communications(from_agent_id);
CREATE INDEX idx_communications_to ON communications(to_agent_id);
CREATE INDEX idx_consensus_swarm ON consensus(swarm_id);
CREATE INDEX idx_consensus_status ON consensus(status);
CREATE INDEX idx_metrics_swarm ON performance_metrics(swarm_id);
CREATE INDEX idx_metrics_timestamp ON performance_metrics(timestamp);

-- Triggers for updated_at
CREATE TRIGGER update_swarms_timestamp 
AFTER UPDATE ON swarms
BEGIN
    UPDATE swarms SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Trigger for memory TTL
CREATE TRIGGER set_memory_expiry
AFTER INSERT ON memory
WHEN NEW.ttl IS NOT NULL
BEGIN
    UPDATE memory 
    SET expires_at = datetime(CURRENT_TIMESTAMP, '+' || NEW.ttl || ' seconds')
    WHERE key = NEW.key AND namespace = NEW.namespace;
END;

-- Trigger for agent activity
CREATE TRIGGER update_agent_activity
AFTER UPDATE OF status ON agents
BEGIN
    UPDATE agents SET last_active_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Views for common queries
CREATE VIEW IF NOT EXISTS active_swarms AS
SELECT s.*, 
       COUNT(DISTINCT a.id) as agent_count,
       COUNT(DISTINCT t.id) as task_count
FROM swarms s
LEFT JOIN agents a ON s.id = a.swarm_id AND a.status != 'offline'
LEFT JOIN tasks t ON s.id = t.swarm_id AND t.status IN ('pending', 'assigned', 'in_progress')
WHERE s.status = 'active'
GROUP BY s.id;

CREATE VIEW IF NOT EXISTS agent_workload AS
SELECT a.*,
       COUNT(DISTINCT t.id) as assigned_tasks,
       AVG(t.progress) as avg_task_progress
FROM agents a
LEFT JOIN tasks t ON t.assigned_agents LIKE '%' || a.id || '%' AND t.status = 'in_progress'
GROUP BY a.id;

CREATE VIEW IF NOT EXISTS task_overview AS
SELECT t.*,
       s.name as swarm_name,
       COUNT(DISTINCT a.id) as assigned_agent_count
FROM tasks t
JOIN swarms s ON t.swarm_id = s.id
LEFT JOIN agents a ON t.assigned_agents LIKE '%' || a.id || '%'
GROUP BY t.id;

-- Initial data
INSERT OR IGNORE INTO memory (key, namespace, value) VALUES 
    ('system.version', 'hive-mind', '2.0.0'),
    ('system.initialized', 'hive-mind', datetime('now'));