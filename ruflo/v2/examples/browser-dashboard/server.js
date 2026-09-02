#!/usr/bin/env node

/**
 * Claude Flow WebSocket Bridge Server
 * Connects browser dashboard to claude-flow MCP tools via WebSocket
 */

import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ClaudeFlowBridge {
    constructor(port = 8080) {
        this.port = port;
        this.clients = new Set();
        this.agents = new Map();
        this.tasks = new Map();

        this.setupServer();
        this.startSimulation();
    }

    setupServer() {
        // HTTP server for serving static files
        this.httpServer = http.createServer((req, res) => {
            let filePath = '.' + req.url;
            if (filePath === './') filePath = './index.html';

            const extname = path.extname(filePath);
            const contentType = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json'
            }[extname] || 'text/plain';

            fs.readFile(filePath, (error, content) => {
                if (error) {
                    if (error.code === 'ENOENT') {
                        res.writeHead(404);
                        res.end('File not found');
                    } else {
                        res.writeHead(500);
                        res.end('Server error');
                    }
                } else {
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(content, 'utf-8');
                }
            });
        });

        // WebSocket server
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws) => {
            console.log('✅ New client connected');
            this.clients.add(ws);

            // Send initial state
            this.sendToClient(ws, {
                type: 'swarm_status',
                status: {
                    agents: Array.from(this.agents.values()),
                    tasks: Array.from(this.tasks.values())
                }
            });

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleClientMessage(ws, data);
                } catch (error) {
                    console.error('❌ Error parsing message:', error);
                }
            });

            ws.on('close', () => {
                console.log('👋 Client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.clients.delete(ws);
            });
        });

        this.httpServer.listen(this.port, () => {
            console.log(`\n🌐 Claude Flow Dashboard Server`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`📊 Dashboard: http://localhost:${this.port}`);
            console.log(`🔌 WebSocket: ws://localhost:${this.port}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        });
    }

    handleClientMessage(ws, data) {
        const { method, params, id } = data;

        console.log(`📨 Received: ${method}`);

        // Route MCP commands
        switch (method) {
            case 'mcp__claude-flow__swarm_status':
                this.handleSwarmStatus(ws, id);
                break;
            case 'mcp__claude-flow__agents_spawn_parallel':
                this.handleSpawnAgents(ws, params, id);
                break;
            case 'mcp__claude-flow__query_control':
                this.handleQueryControl(ws, params, id);
                break;
            case 'mcp__agentic-payments__verify_consensus':
                this.handleConsensus(ws, params, id);
                break;
            default:
                this.sendToClient(ws, {
                    jsonrpc: '2.0',
                    error: { code: -32601, message: 'Method not found' },
                    id
                });
        }
    }

    handleSwarmStatus(ws, id) {
        this.sendToClient(ws, {
            jsonrpc: '2.0',
            result: {
                agents: Array.from(this.agents.values()),
                tasks: Array.from(this.tasks.values()),
                topology: 'mesh',
                active: true
            },
            id
        });
    }

    handleSpawnAgents(ws, params, id) {
        const { agents = [], maxConcurrency = 5 } = params;

        console.log(`🚀 Spawning ${agents.length} agents...`);

        // Simulate parallel spawning
        agents.forEach((agentConfig, index) => {
            setTimeout(() => {
                const agent = {
                    id: `agent-${Date.now()}-${index}`,
                    name: agentConfig.name || `Agent-${index}`,
                    type: agentConfig.type,
                    status: 'active',
                    priority: agentConfig.priority || 'medium',
                    spawnedAt: new Date().toISOString()
                };

                this.agents.set(agent.id, agent);

                // Broadcast to all clients
                this.broadcast({
                    type: 'agent_update',
                    agent
                });
            }, index * (1000 / maxConcurrency)); // Simulate parallel spawning speed
        });

        this.sendToClient(ws, {
            jsonrpc: '2.0',
            result: {
                success: true,
                agentsSpawned: agents.length,
                estimatedTime: `${Math.ceil(agents.length / maxConcurrency) * 100}ms`
            },
            id
        });
    }

    handleQueryControl(ws, params, id) {
        const { action, queryId } = params;

        console.log(`🎮 Query control: ${action} on ${queryId}`);

        this.sendToClient(ws, {
            jsonrpc: '2.0',
            result: {
                success: true,
                action,
                queryId,
                timestamp: new Date().toISOString()
            },
            id
        });

        // Broadcast status update
        this.broadcast({
            type: 'query_update',
            query: {
                id: queryId,
                action,
                status: action === 'pause' ? 'paused' : 'running'
            }
        });
    }

    handleConsensus(ws, params, id) {
        const { agent_public_keys = [], consensus_threshold = 0.65 } = params;
        const totalAgents = agent_public_keys.length;
        const requiredVotes = Math.ceil(totalAgents * consensus_threshold);

        console.log(`🗳️  Byzantine consensus: ${requiredVotes}/${totalAgents} required`);

        // Simulate consensus voting
        let votesFor = 0;
        const interval = setInterval(() => {
            votesFor += Math.floor(Math.random() * 3) + 1;
            if (votesFor > totalAgents) votesFor = totalAgents;

            const consensusReached = votesFor >= requiredVotes;

            this.broadcast({
                type: 'consensus_update',
                consensus: {
                    votesFor,
                    votesAgainst: totalAgents - votesFor,
                    total: totalAgents,
                    threshold: requiredVotes,
                    reached: consensusReached,
                    percentage: (votesFor / totalAgents * 100).toFixed(1)
                }
            });

            if (votesFor >= totalAgents) {
                clearInterval(interval);

                this.sendToClient(ws, {
                    jsonrpc: '2.0',
                    result: {
                        success: true,
                        consensus_reached: true,
                        votes_for: votesFor,
                        votes_against: totalAgents - votesFor,
                        total_latency_ms: 1,
                        byzantine_fault_tolerance: {
                            max_compromised_agents: Math.floor((totalAgents - 1) / 3),
                            is_byzantine_secure: true
                        }
                    },
                    id
                });
            }
        }, 200);
    }

    sendToClient(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    broadcast(data) {
        this.clients.forEach(client => {
            this.sendToClient(client, data);
        });
    }

    startSimulation() {
        // Create initial demo agents
        const demoAgents = [
            { type: 'researcher', name: 'Researcher-1', status: 'active' },
            { type: 'coder', name: 'Coder-1', status: 'active' },
            { type: 'reviewer', name: 'Reviewer-1', status: 'idle' },
            { type: 'tester', name: 'Tester-1', status: 'active' },
            { type: 'analyst', name: 'Analyst-1', status: 'idle' }
        ];

        demoAgents.forEach((config, index) => {
            const agent = {
                id: `demo-agent-${index}`,
                ...config,
                spawnedAt: new Date().toISOString()
            };
            this.agents.set(agent.id, agent);
        });

        console.log(`✨ Created ${demoAgents.length} demo agents`);

        // Periodic status updates
        setInterval(() => {
            // Random agent status changes
            this.agents.forEach(agent => {
                if (Math.random() > 0.95) {
                    agent.status = agent.status === 'active' ? 'idle' : 'active';
                    this.broadcast({
                        type: 'agent_update',
                        agent
                    });
                }
            });
        }, 5000);
    }
}

// Start server
const server = new ClaudeFlowBridge(process.env.PORT || 8080);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down server...');
    process.exit(0);
});
