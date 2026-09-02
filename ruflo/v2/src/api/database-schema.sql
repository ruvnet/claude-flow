-- Database schema for Claude Flow swarm coordination system
-- Supports PostgreSQL, MySQL, and SQLite

-- Swarms table - stores swarm configurations and metadata
CREATE TABLE IF NOT EXISTS swarms (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    topology ENUM('hierarchical', 'mesh', 'ring', 'star') NOT NULL,
    max_agents INTEGER DEFAULT 8,
    strategy ENUM('balanced', 'specialized', 'adaptive') DEFAULT 'balanced',
    status ENUM('initializing', 'active', 'paused', 'destroyed') DEFAULT 'initializing',
    config JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    destroyed_at TIMESTAMP NULL,
    INDEX idx_swarms_status (status),
    INDEX idx_swarms_created_at (created_at)
);

-- Agents table - stores individual agent information
CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(255) PRIMARY KEY,
    swarm_id VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    name VARCHAR(255),
    status ENUM('spawning', 'idle', 'busy', 'error', 'terminated') DEFAULT 'spawning',
    capabilities JSON,
    config JSON,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    terminated_at TIMESTAMP NULL,
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE,
    INDEX idx_agents_swarm (swarm_id),
    INDEX idx_agents_status (status),
    INDEX idx_agents_type (type)
);

-- Tasks table - stores task definitions and state
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(255) PRIMARY KEY,
    swarm_id VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    strategy ENUM('parallel', 'sequential', 'adaptive') DEFAULT 'adaptive',
    status ENUM('pending', 'assigned', 'running', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    max_agents INTEGER,
    requirements JSON,
    metadata JSON,
    result JSON,
    error_message TEXT,
    assigned_to VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES agents(id) ON DELETE SET NULL,
    INDEX idx_tasks_swarm (swarm_id),
    INDEX idx_tasks_status (status),
    INDEX idx_tasks_priority (priority),
    INDEX idx_tasks_created_at (created_at)
);

-- Task assignments table - many-to-many relationship between tasks and agents
CREATE TABLE IF NOT EXISTS task_assignments (
    id VARCHAR(255) PRIMARY KEY,
    task_id VARCHAR(255) NOT NULL,
    agent_id VARCHAR(255) NOT NULL,
    status ENUM('assigned', 'active', 'completed', 'failed', 'cancelled') DEFAULT 'assigned',
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    UNIQUE KEY unique_task_agent (task_id, agent_id),
    INDEX idx_assignments_task (task_id),
    INDEX idx_assignments_agent (agent_id),
    INDEX idx_assignments_status (status)
);

-- Resources table - tracks system resources and their allocation
CREATE TABLE IF NOT EXISTS resources (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    capacity INTEGER DEFAULT 1,
    status ENUM('available', 'allocated', 'locked', 'error') DEFAULT 'available',
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_resources_type (type),
    INDEX idx_resources_status (status)
);

-- Resource allocations table - tracks which agents have which resources
CREATE TABLE IF NOT EXISTS resource_allocations (
    id VARCHAR(255) PRIMARY KEY,
    resource_id VARCHAR(255) NOT NULL,
    agent_id VARCHAR(255) NOT NULL,
    allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMP NULL,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    INDEX idx_allocations_resource (resource_id),
    INDEX idx_allocations_agent (agent_id),
    INDEX idx_allocations_active (released_at)
);

-- Messages table - inter-agent communication log
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(255) PRIMARY KEY,
    from_agent_id VARCHAR(255) NOT NULL,
    to_agent_id VARCHAR(255) NOT NULL,
    message_type VARCHAR(100) NOT NULL,
    content JSON NOT NULL,
    status ENUM('sent', 'delivered', 'failed') DEFAULT 'sent',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP NULL,
    FOREIGN KEY (from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (to_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    INDEX idx_messages_from (from_agent_id),
    INDEX idx_messages_to (to_agent_id),
    INDEX idx_messages_type (message_type),
    INDEX idx_messages_created_at (created_at)
);

-- Performance metrics table - system and swarm performance data
CREATE TABLE IF NOT EXISTS performance_metrics (
    id VARCHAR(255) PRIMARY KEY,
    swarm_id VARCHAR(255),
    agent_id VARCHAR(255),
    metric_type VARCHAR(100) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL(15,4) NOT NULL,
    unit VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    INDEX idx_metrics_swarm (swarm_id),
    INDEX idx_metrics_agent (agent_id),
    INDEX idx_metrics_type (metric_type),
    INDEX idx_metrics_timestamp (timestamp)
);

-- Events table - system events and audit log
CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(255) PRIMARY KEY,
    swarm_id VARCHAR(255),
    agent_id VARCHAR(255),
    event_type VARCHAR(100) NOT NULL,
    event_name VARCHAR(255) NOT NULL,
    event_data JSON,
    severity ENUM('debug', 'info', 'warning', 'error', 'critical') DEFAULT 'info',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (swarm_id) REFERENCES swarms(id) ON DELETE SET NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
    INDEX idx_events_swarm (swarm_id),
    INDEX idx_events_agent (agent_id),
    INDEX idx_events_type (event_type),
    INDEX idx_events_severity (severity),
    INDEX idx_events_created_at (created_at)
);

-- Sessions table - tracks MCP and API sessions
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(255) PRIMARY KEY,
    session_type ENUM('mcp', 'api', 'websocket') NOT NULL,
    user_id VARCHAR(255),
    client_info JSON,
    status ENUM('active', 'expired', 'terminated') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    terminated_at TIMESTAMP NULL,
    INDEX idx_sessions_type (session_type),
    INDEX idx_sessions_status (status),
    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_created_at (created_at)
);

-- Configuration table - dynamic system configuration
CREATE TABLE IF NOT EXISTS configuration (
    id VARCHAR(255) PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    key_name VARCHAR(255) NOT NULL,
    key_value JSON NOT NULL,
    description TEXT,
    is_encrypted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_category_key (category, key_name),
    INDEX idx_config_category (category)
);

-- Memory store table - persistent key-value storage for agents and swarms
CREATE TABLE IF NOT EXISTS memory_store (
    id VARCHAR(255) PRIMARY KEY,
    namespace VARCHAR(255) NOT NULL DEFAULT 'default',
    key_name VARCHAR(255) NOT NULL,
    value JSON NOT NULL,
    ttl INTEGER, -- Time to live in seconds
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,
    UNIQUE KEY unique_namespace_key (namespace, key_name),
    INDEX idx_memory_namespace (namespace),
    INDEX idx_memory_expires_at (expires_at)
);

-- Triggers for automatic timestamp updates (MySQL/PostgreSQL)
DELIMITER //
CREATE TRIGGER update_swarms_timestamp
    BEFORE UPDATE ON swarms
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//

CREATE TRIGGER update_agents_timestamp
    BEFORE UPDATE ON agents
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//

CREATE TRIGGER update_tasks_timestamp
    BEFORE UPDATE ON tasks
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//

CREATE TRIGGER update_resources_timestamp
    BEFORE UPDATE ON resources
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//

CREATE TRIGGER update_sessions_timestamp
    BEFORE UPDATE ON sessions
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//

CREATE TRIGGER update_configuration_timestamp
    BEFORE UPDATE ON configuration
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//

CREATE TRIGGER update_memory_store_timestamp
    BEFORE UPDATE ON memory_store
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//
DELIMITER ;

-- Views for common queries
CREATE VIEW active_swarms AS
SELECT s.*, COUNT(a.id) as agent_count
FROM swarms s
LEFT JOIN agents a ON s.id = a.swarm_id AND a.status != 'terminated'
WHERE s.status = 'active'
GROUP BY s.id;

CREATE VIEW swarm_metrics AS
SELECT 
    s.id as swarm_id,
    s.name,
    s.status,
    COUNT(DISTINCT a.id) as total_agents,
    COUNT(DISTINCT CASE WHEN a.status IN ('idle', 'busy') THEN a.id END) as active_agents,
    COUNT(DISTINCT t.id) as total_tasks,
    COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as completed_tasks,
    COUNT(DISTINCT CASE WHEN t.status = 'failed' THEN t.id END) as failed_tasks,
    COUNT(DISTINCT CASE WHEN t.status IN ('pending', 'assigned', 'running') THEN t.id END) as active_tasks,
    AVG(CASE WHEN t.completed_at IS NOT NULL AND t.started_at IS NOT NULL 
        THEN TIMESTAMPDIFF(SECOND, t.started_at, t.completed_at) END) as avg_task_duration_seconds
FROM swarms s
LEFT JOIN agents a ON s.id = a.swarm_id
LEFT JOIN tasks t ON s.id = t.swarm_id
WHERE s.status != 'destroyed'
GROUP BY s.id, s.name, s.status;

CREATE VIEW resource_utilization AS
SELECT 
    r.id,
    r.name,
    r.type,
    r.capacity,
    COUNT(ra.id) as allocated_count,
    ROUND((COUNT(ra.id) / r.capacity) * 100, 2) as utilization_percentage
FROM resources r
LEFT JOIN resource_allocations ra ON r.id = ra.resource_id AND ra.released_at IS NULL
WHERE r.status = 'available'
GROUP BY r.id, r.name, r.type, r.capacity;

-- Cleanup procedures for maintenance
DELIMITER //
CREATE PROCEDURE CleanupExpiredSessions()
BEGIN
    DELETE FROM sessions 
    WHERE status = 'expired' 
    AND terminated_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
END//

CREATE PROCEDURE CleanupExpiredMemory()
BEGIN
    DELETE FROM memory_store 
    WHERE expires_at IS NOT NULL 
    AND expires_at < NOW();
END//

CREATE PROCEDURE CleanupOldEvents()
BEGIN
    DELETE FROM events 
    WHERE severity IN ('debug', 'info') 
    AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
    
    DELETE FROM events 
    WHERE severity = 'warning' 
    AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
END//

CREATE PROCEDURE CleanupOldMetrics()
BEGIN
    DELETE FROM performance_metrics 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 90 DAY);
END//
DELIMITER ;

-- Sample data for testing (optional)
-- INSERT INTO swarms (id, name, topology, status) VALUES 
--     ('swarm-001', 'Development Swarm', 'hierarchical', 'active'),
--     ('swarm-002', 'Production Swarm', 'mesh', 'active');

-- INSERT INTO agents (id, swarm_id, type, name, status, capabilities) VALUES
--     ('agent-001', 'swarm-001', 'coordinator', 'Main Coordinator', 'idle', '["task-management", "resource-allocation"]'),
--     ('agent-002', 'swarm-001', 'worker', 'Worker 1', 'idle', '["data-processing", "file-io"]'),
--     ('agent-003', 'swarm-001', 'worker', 'Worker 2', 'idle', '["api-calls", "data-validation"]');

-- INSERT INTO resources (id, name, type, capacity, status) VALUES
--     ('cpu-001', 'CPU Core 1', 'compute', 1, 'available'),
--     ('cpu-002', 'CPU Core 2', 'compute', 1, 'available'),
--     ('memory-001', 'Memory Pool 1', 'memory', 4, 'available'),
--     ('storage-001', 'Temp Storage', 'storage', 10, 'available');

-- Comments and documentation
-- This schema supports:
-- 1. Multi-swarm environments with different topologies
-- 2. Dynamic agent spawning and management
-- 3. Task orchestration with priorities and strategies
-- 4. Resource allocation and conflict resolution
-- 5. Inter-agent messaging and coordination
-- 6. Performance monitoring and metrics collection
-- 7. Event logging and audit trails
-- 8. Session management for MCP and API clients
-- 9. Dynamic configuration management
-- 10. Persistent memory with TTL support