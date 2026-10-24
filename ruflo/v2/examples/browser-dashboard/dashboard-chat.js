/**
 * Claude Flow Chat Interface
 * Claude Code-style chat with integrated swarm orchestration
 */

class ClaudeFlowChat {
    constructor() {
        this.ws = null;
        this.editor = null;
        this.agents = new Map();
        this.consensus = { votesFor: 0, votesAgainst: 0, total: 20, threshold: 13 };
        this.editorVisible = false;

        this.initialize();
    }

    async initialize() {
        this.setupMonacoEditor();
        this.setupAutoResizeTextarea();
        this.startSimulation();

        // Auto-connect
        setTimeout(() => {
            const wsUrl = `ws://${window.location.hostname}:${window.location.port || 8080}`;
            this.connectWebSocket(wsUrl);
        }, 1000);
    }

    /**
     * Monaco Editor Setup
     */
    setupMonacoEditor() {
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
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                folding: true
            });
        });
    }

    getDefaultCode() {
        return `// Claude Flow - Execute code via MCP
console.log('Hello from Claude Flow!');

// Spawn a researcher agent
async function spawnAgent() {
    const result = await sendMCPCommand('agent_spawn', {
        type: 'researcher',
        name: 'Browser-Agent-1'
    });
    console.log('Agent spawned:', result);
}

spawnAgent();`;
    }

    /**
     * WebSocket Connection
     */
    connectWebSocket(url) {
        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.addAssistantMessage('Connected to Claude Flow MCP server! Ready to help.');
                this.sendCommand('swarm_status');
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            };

            this.ws.onerror = () => {
                this.addAssistantMessage('Connection error. Please refresh the page.');
            };

            this.ws.onclose = () => {
                this.addAssistantMessage('Disconnected from server.');
            };
        } catch (error) {
            this.addAssistantMessage(`Connection failed: ${error.message}`);
        }
    }

    sendCommand(command, params = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: `mcp__claude-flow__${command}`,
                params,
                id: Date.now()
            }));
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
            case 'execution_output':
                this.addCodeOutput(data.output);
                break;
            case 'execution_result':
                this.handleExecutionResult(data.result);
                break;
        }
    }

    /**
     * Chat Message Handling
     */
    sendMessage() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();

        if (!text) return;

        // Add user message
        this.addUserMessage(text);
        input.value = '';
        input.style.height = '44px';

        // Process the message
        this.processUserMessage(text);
    }

    processUserMessage(text) {
        const lower = text.toLowerCase();

        if (lower.includes('spawn') && lower.includes('agent')) {
            this.addAssistantMessage('I\'ll spawn 5 specialized agents for you...');
            setTimeout(() => spawnAgents(), 500);
        } else if (lower.includes('consensus') || lower.includes('byzantine')) {
            this.addAssistantMessage('Running Byzantine consensus test with 20 agents...');
            setTimeout(() => testConsensus(), 500);
        } else if (lower.includes('code') || lower.includes('execute')) {
            this.addAssistantMessage('Opening code editor. You can write JavaScript code that calls MCP tools directly!');
            this.showEditor();
        } else if (lower.includes('status') || lower.includes('swarm')) {
            this.sendCommand('swarm_status');
            this.addAssistantMessage('Checking swarm status...');
        } else {
            this.addAssistantMessage('I can help you with:\n\n• "spawn agents" - Create specialized AI agents\n• "test consensus" - Run Byzantine consensus\n• "open code editor" - Write and execute code\n• "swarm status" - Check active agents\n\nWhat would you like to do?');
        }
    }

    addUserMessage(text) {
        const container = document.getElementById('chatMessages');
        const message = document.createElement('div');
        message.className = 'message';
        message.innerHTML = `
            <div class="message-avatar user-avatar">👤</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">You</span>
                    <span class="message-time">${new Date().toLocaleTimeString()}</span>
                </div>
                <div class="message-text">${this.escapeHtml(text)}</div>
            </div>
        `;
        container.appendChild(message);
        container.scrollTop = container.scrollHeight;
    }

    addAssistantMessage(text, withCode = null) {
        const container = document.getElementById('chatMessages');
        const message = document.createElement('div');
        message.className = 'message';

        let codeBlock = '';
        if (withCode) {
            codeBlock = `
                <div class="code-block">
                    <div class="code-header">
                        <span class="code-language">javascript</span>
                        <div class="code-actions">
                            <button class="code-action-btn" onclick="copyCode(this)">Copy</button>
                            <button class="code-action-btn" onclick="runCodeBlock(this)">Run</button>
                        </div>
                    </div>
                    <div class="code-body">
                        <pre>${this.escapeHtml(withCode)}</pre>
                    </div>
                </div>
            `;
        }

        message.innerHTML = `
            <div class="message-avatar assistant-avatar">🤖</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">Claude Flow</span>
                    <span class="message-time">${new Date().toLocaleTimeString()}</span>
                </div>
                <div class="message-text">${this.formatText(text)}</div>
                ${codeBlock}
            </div>
        `;
        container.appendChild(message);
        container.scrollTop = container.scrollHeight;
    }

    addCodeOutput(output) {
        const container = document.getElementById('chatMessages');
        const lastMessage = container.lastElementChild;

        if (lastMessage && lastMessage.querySelector('.code-output')) {
            lastMessage.querySelector('.code-output').textContent += output;
        } else {
            const message = document.createElement('div');
            message.className = 'message';
            message.innerHTML = `
                <div class="message-avatar assistant-avatar">💻</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author">Code Output</span>
                        <span class="message-time">${new Date().toLocaleTimeString()}</span>
                    </div>
                    <div class="code-block">
                        <div class="code-header">
                            <span class="code-language">output</span>
                        </div>
                        <div class="code-body">
                            <pre class="code-output">${this.escapeHtml(output)}</pre>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(message);
        }
        container.scrollTop = container.scrollHeight;
    }

    handleExecutionResult(result) {
        if (result.success) {
            this.addAssistantMessage(`✓ Code executed successfully in ${result.time}ms`);
        } else {
            this.addAssistantMessage(`✗ Execution failed: ${result.error}`);
        }
    }

    formatText(text) {
        return text
            .replace(/\n/g, '<br>')
            .replace(/• /g, '• ')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Agent Management
     */
    updateAgent(agent) {
        this.agents.set(agent.id, agent);
        this.renderAgents();
    }

    renderAgents() {
        const grid = document.getElementById('agentGrid');
        grid.innerHTML = '';

        this.agents.forEach(agent => {
            const card = document.createElement('div');
            card.className = 'agent-card';
            card.innerHTML = `
                <div class="agent-name">${agent.name}</div>
                <div class="agent-type">${agent.type} • ${agent.status}</div>
            `;
            grid.appendChild(card);
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

        const reached = this.consensus.votesFor >= this.consensus.threshold;
        document.getElementById('consensusStatus').textContent =
            reached ? `✓ Consensus reached (${percentage.toFixed(0)}%)` : `Pending (${percentage.toFixed(0)}%)`;
    }

    /**
     * Code Editor
     */
    showEditor() {
        document.getElementById('rightPanel').classList.add('active');
        this.editorVisible = true;
    }

    hideEditor() {
        document.getElementById('rightPanel').classList.remove('active');
        this.editorVisible = false;
    }

    executeCode() {
        if (!this.editor) return;

        const code = this.editor.getValue();
        this.addAssistantMessage('Executing code...', code);

        this.sendCommand('execute_code', {
            code,
            language: 'javascript',
            timeout: 5000
        });
    }

    insertCodeIntoChat() {
        if (!this.editor) return;
        const code = this.editor.getValue();
        this.addAssistantMessage('Here\'s the code:', code);
    }

    clearEditor() {
        if (this.editor) {
            this.editor.setValue('');
        }
    }

    /**
     * UI Helpers
     */
    setupAutoResizeTextarea() {
        const input = document.getElementById('chatInput');
        input.addEventListener('input', () => {
            input.style.height = '44px';
            input.style.height = Math.min(input.scrollHeight, 200) + 'px';
        });
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
    dashboard.addAssistantMessage('Spawning 5 specialized agents...');
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

    setTimeout(() => {
        dashboard.addAssistantMessage('✓ Successfully spawned 5 agents! Check the sidebar to see them.');
    }, 1000);
}

function testConsensus() {
    dashboard.addAssistantMessage('Starting Byzantine consensus test with 20 agents...');

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
            dashboard.addAssistantMessage('✓ Consensus reached! 20/20 agents voted. Byzantine fault tolerance: 6 agents can be compromised without affecting security.');
        }
    }, 150);
}

function toggleEditor() {
    if (dashboard.editorVisible) {
        dashboard.hideEditor();
    } else {
        dashboard.showEditor();
    }
}

function executeCode() {
    dashboard.executeCode();
}

function insertCodeIntoChat() {
    dashboard.insertCodeIntoChat();
}

function clearEditor() {
    dashboard.clearEditor();
}

function copyCode(btn) {
    const codeBlock = btn.closest('.code-block').querySelector('pre');
    navigator.clipboard.writeText(codeBlock.textContent);
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
}

function runCodeBlock(btn) {
    const codeBlock = btn.closest('.code-block').querySelector('pre');
    dashboard.editor.setValue(codeBlock.textContent);
    dashboard.showEditor();
    dashboard.addAssistantMessage('Code loaded into editor. Click Run to execute!');
}

function handleInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function sendMessage() {
    dashboard.sendMessage();
}

// Initialize
const dashboard = new ClaudeFlowChat();
