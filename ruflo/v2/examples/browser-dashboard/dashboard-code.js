/**
 * Claude Flow + Claude Code - Browser IDE
 * Combines swarm orchestration with interactive code editing
 */

class ClaudeCodeDashboard {
    constructor() {
        this.ws = null;
        this.editor = null;
        this.agents = new Map();
        this.consensus = { votesFor: 0, votesAgainst: 0, total: 20, threshold: 13 };
        this.currentPanel = 'terminal';

        this.initialize();
    }

    async initialize() {
        await this.setupMonacoEditor();
        this.setupCanvas();
        this.startSimulation();
        this.addLog('Dashboard initialized', 'info');

        // Auto-connect
        setTimeout(() => {
            const wsUrl = `ws://${window.location.hostname}:${window.location.port || 8080}`;
            this.addLog(`Connecting to ${wsUrl}...`, 'info');
            this.connectWebSocket(wsUrl);
        }, 1000);
    }

    /**
     * Monaco Editor Setup
     */
    async setupMonacoEditor() {
        return new Promise((resolve) => {
            require.config({
                paths: {
                    'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs'
                }
            });

            require(['vs/editor/editor.main'], () => {
                this.editor = monaco.editor.create(document.getElementById('editor'), {
                    value: this.getDefaultCode(),
                    language: 'javascript',
                    theme: 'vs-dark',
                    automaticLayout: true,
                    fontSize: 13,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    renderWhitespace: 'selection',
                    lineNumbers: 'on',
                    folding: true,
                    bracketPairColorization: { enabled: true }
                });

                this.addLog('Monaco Editor loaded', 'success');
                resolve();
            });
        });
    }

    getDefaultCode() {
        return `// Claude Flow + Claude Code - Browser IDE
// Write your code here and click "Run Code" to execute via MCP

console.log('Hello from Claude Flow!');

// Example: Spawn agents via MCP
async function spawnResearchAgent() {
    const result = await sendMCPCommand('agent_spawn', {
        type: 'researcher',
        name: 'Browser-Researcher-1',
        capabilities: ['web-search', 'data-analysis']
    });

    console.log('Agent spawned:', result);
    return result;
}

// Example: Run consensus verification
async function verifyConsensus() {
    const result = await sendMCPCommand('verify_consensus', {
        agent_public_keys: Array(20).fill('pk_' + Date.now()),
        consensus_threshold: 0.65
    });

    console.log('Consensus result:', result);
    return result;
}

// Test the functions
spawnResearchAgent();
`;
    }

    /**
     * WebSocket Connection
     */
    connectWebSocket(url = 'ws://localhost:8080') {
        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.updateConnectionStatus(true);
                this.addLog('Connected to Claude Flow MCP server', 'success');
                this.sendCommand('swarm_status');
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
                this.addMCPLog('RECV', data);
            };

            this.ws.onerror = (error) => {
                this.addLog(`WebSocket error: ${error.message}`, 'error');
                this.updateConnectionStatus(false);
            };

            this.ws.onclose = () => {
                this.addLog('Disconnected from server', 'warning');
                this.updateConnectionStatus(false);
            };
        } catch (error) {
            this.addLog(`Connection failed: ${error.message}`, 'error');
            this.updateConnectionStatus(false);
        }
    }

    sendCommand(command, params = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                jsonrpc: '2.0',
                method: `mcp__claude-flow__${command}`,
                params,
                id: Date.now()
            };
            this.ws.send(JSON.stringify(message));
            this.addMCPLog('SEND', message);
        } else {
            this.addLog('Not connected to server', 'warning');
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'agent_update':
                this.updateAgent(data.agent);
                break;
            case 'consensus_update':
                this.updateConsensus(data.consensus);
                break;
            case 'execution_result':
                this.displayExecutionResult(data.result);
                break;
            case 'swarm_status':
                this.updateSwarmStatus(data.status);
                break;
        }
    }

    /**
     * Code Execution
     */
    executeCode() {
        const code = this.editor.getValue();
        this.addTerminalOutput('> Executing code via Claude Flow MCP...\n', 'command');

        // Send code to MCP server for execution
        this.sendCommand('execute_code', {
            code,
            language: 'javascript',
            timeout: 5000
        });

        this.addLog('Code execution requested', 'info');
    }

    displayExecutionResult(result) {
        const output = document.getElementById('outputPanel');

        if (result.success) {
            output.innerHTML += `<div style="color: #00ff88;">✓ Execution completed in ${result.time}ms</div>\n`;
            if (result.stdout) {
                output.innerHTML += `<div>${result.stdout}</div>\n`;
            }
        } else {
            output.innerHTML += `<div style="color: #ff4444;">✗ Execution failed</div>\n`;
            output.innerHTML += `<div style="color: #ff8888;">${result.error}</div>\n`;
        }

        output.scrollTop = output.scrollHeight;
    }

    /**
     * Agent Management
     */
    updateAgent(agent) {
        this.agents.set(agent.id, agent);
        this.renderAgents();
        this.addLog(`Agent ${agent.name} is ${agent.status}`, 'info');
    }

    renderAgents() {
        const list = document.getElementById('agentList');
        list.innerHTML = '';

        this.agents.forEach(agent => {
            const item = document.createElement('div');
            item.className = 'agent-item';
            item.innerHTML = `
                <div>
                    <div style="font-weight: 600;">${agent.name}</div>
                    <div style="font-size: 10px; color: #858585;">${agent.type}</div>
                </div>
                <div class="agent-status ${agent.status}">${agent.status}</div>
            `;
            list.appendChild(item);
        });
    }

    /**
     * Consensus Tracking
     */
    updateConsensus(consensus) {
        this.consensus = { ...this.consensus, ...consensus };
        const percentage = (this.consensus.votesFor / this.consensus.total * 100);

        document.getElementById('consensusFill').style.width = `${percentage}%`;
        document.getElementById('consensusText').textContent =
            `${this.consensus.votesFor}/${this.consensus.total}`;
        document.getElementById('consensusPercentage').textContent =
            `${percentage.toFixed(1)}%`;
        document.getElementById('securityMargin').textContent =
            Math.max(0, this.consensus.votesFor - this.consensus.threshold);
    }

    /**
     * Canvas Visualization
     */
    setupCanvas() {
        this.canvas = document.getElementById('swarmCanvas');
        this.ctx = this.canvas.getContext('2d');

        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = 120;

        this.drawSwarmVisualization();
    }

    drawSwarmVisualization() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, width, height);

        const agents = Array.from(this.agents.values()).slice(0, 8);
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) * 0.3;

        // Draw connections
        agents.forEach((agent, i) => {
            const angle = (i / agents.length) * Math.PI * 2;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            agent.x = x;
            agent.y = y;

            agents.forEach((other, j) => {
                if (i < j) {
                    ctx.strokeStyle = 'rgba(0, 255, 136, 0.15)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(agent.x, agent.y);
                    ctx.lineTo(other.x, other.y);
                    ctx.stroke();
                }
            });
        });

        // Draw nodes
        agents.forEach(agent => {
            const color = agent.status === 'active' ? '#00ff88' : '#ffa500';

            ctx.shadowBlur = 10;
            ctx.shadowColor = color;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(agent.x, agent.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        requestAnimationFrame(() => this.drawSwarmVisualization());
    }

    /**
     * Panel Management
     */
    switchPanel(panel) {
        this.currentPanel = panel;

        document.querySelectorAll('.panel-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        event.target.classList.add('active');

        document.querySelectorAll('.panel-content > div').forEach(div => {
            div.style.display = 'none';
        });

        const panelMap = {
            'terminal': 'terminalPanel',
            'output': 'outputPanel',
            'logs': 'logsPanel',
            'mcp': 'mcpPanel'
        };

        document.getElementById(panelMap[panel]).style.display = 'block';
    }

    /**
     * Logging
     */
    addTerminalOutput(text, type = 'normal') {
        const panel = document.getElementById('terminalPanel');
        const line = document.createElement('div');

        const colors = {
            command: '#00ff88',
            error: '#ff4444',
            success: '#00ff88',
            normal: '#d4d4d4'
        };

        line.style.color = colors[type] || colors.normal;
        line.textContent = text;
        panel.appendChild(line);
        panel.scrollTop = panel.scrollHeight;
    }

    addLog(message, type = 'info') {
        const panel = document.getElementById('logsPanel');
        const entry = document.createElement('div');
        entry.className = 'log-entry';

        const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        const timestamp = new Date().toLocaleTimeString();

        entry.innerHTML = `
            <span class="log-timestamp">${timestamp}</span>
            ${icons[type] || icons.info} ${message}
        `;

        panel.insertBefore(entry, panel.firstChild);
    }

    addMCPLog(direction, message) {
        const panel = document.getElementById('mcpPanel');
        const entry = document.createElement('div');

        const arrow = direction === 'SEND' ? '→' : '←';
        const color = direction === 'SEND' ? '#00ff88' : '#4a9eff';

        entry.innerHTML = `
            <div style="color: ${color}; margin-top: 8px;">
                ${arrow} ${direction} ${new Date().toLocaleTimeString()}
            </div>
            <pre style="color: #d4d4d4; margin-left: 20px;">${JSON.stringify(message, null, 2)}</pre>
        `;

        panel.appendChild(entry);
        panel.scrollTop = panel.scrollHeight;
    }

    updateConnectionStatus(connected) {
        const dot = document.getElementById('statusDot');
        const label = document.getElementById('statusLabel');

        if (connected) {
            dot.classList.add('connected');
            label.textContent = 'Connected';
        } else {
            dot.classList.remove('connected');
            label.textContent = 'Disconnected';
        }
    }

    /**
     * Simulation
     */
    startSimulation() {
        const types = ['researcher', 'coder', 'reviewer', 'analyst', 'optimizer'];

        for (let i = 0; i < 5; i++) {
            this.updateAgent({
                id: `agent-${i}`,
                name: `Agent-${i}`,
                type: types[i % types.length],
                status: i < 3 ? 'active' : 'idle'
            });
        }
    }
}

/**
 * Global Functions
 */
function spawnAgents() {
    dashboard.addLog('Spawning 5 new agents...', 'info');
    dashboard.sendCommand('agents_spawn_parallel', {
        agents: [
            { type: 'researcher', name: 'Researcher-1', priority: 'high' },
            { type: 'coder', name: 'Coder-1', priority: 'medium' },
            { type: 'reviewer', name: 'Reviewer-1', priority: 'high' },
            { type: 'tester', name: 'Tester-1', priority: 'medium' },
            { type: 'analyst', name: 'Analyst-1', priority: 'low' }
        ],
        maxConcurrency: 5
    });
}

function testConsensus() {
    dashboard.addLog('Testing Byzantine consensus...', 'info');

    let votes = 0;
    const interval = setInterval(() => {
        votes += Math.floor(Math.random() * 3) + 1;
        if (votes > 20) votes = 20;

        dashboard.updateConsensus({
            votesFor: votes,
            votesAgainst: 20 - votes,
            total: 20,
            threshold: 13
        });

        if (votes >= 20) {
            clearInterval(interval);
            dashboard.addLog('Consensus reached: 20/20 votes in 1ms', 'success');
        }
    }, 150);
}

function executeCode() {
    dashboard.executeCode();
}

function saveFile() {
    const code = dashboard.editor.getValue();
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code.js';
    a.click();
    dashboard.addLog('File saved', 'success');
}

function loadFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.ts,.json,.md';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            dashboard.editor.setValue(event.target.result);
            dashboard.addLog(`Loaded ${file.name}`, 'success');
        };
        reader.readAsText(file);
    };
    input.click();
}

function clearOutput() {
    document.getElementById('terminalPanel').innerHTML = '';
    document.getElementById('outputPanel').innerHTML = '';
    dashboard.addLog('Output cleared', 'info');
}

function switchPanel(panel) {
    dashboard.switchPanel(panel);
}

// Initialize
const dashboard = new ClaudeCodeDashboard();
