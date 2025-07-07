/**
 * Swarm spawning utilities
 */

interface Agent {
  id: string;
  type: string;
  status: string;
  name: string;
  task: string;
  parentId?: string;
  terminalId?: string;
}

interface SwarmState {
  swarmId: string;
  objective: string;
  agents: Map<string, Agent>;
  startTime: number;
}

const swarmStates = new Map<string, SwarmState>();

export function initializeSwarm(swarmId: string, objective: string): void {
  swarmStates.set(swarmId, {
    swarmId: swarmId,
    objective,
    agents: new Map<string, Agent>(),
    startTime: Date.now(),
  });
}

export async function spawnSwarmAgent(swarmId: string, agentType: string, task: string): Promise<string> {
  const swarm = swarmStates.get(swarmId);
  if (!swarm) {
    throw new Error(`Swarm ${swarmId} not found`);
  }
  
  const agentId = `${swarmId}-agent-${Date.now()}`;
  // Convert Map to Array if needed
  const agents = swarm.agents instanceof Map ? Array.from(swarm.agents.values()) : swarm.agents;
  const newAgent: any = {
    id: agentId,
    type: agentType,
    status: 'active' as const,
  };
  
  if (swarm.agents instanceof Map) {
    swarm.agents.set(agentId, newAgent);
  } else {
    agents.push(newAgent);
  }
  
  // In a real implementation, this would spawn actual Claude instances
  console.log(`[SWARM] Spawned ${agentType} agent: ${agentId}`);
  console.log(`[SWARM] Task: ${task}`);
  
  return agentId;
}

export async function monitorSwarm(swarmId: string): Promise<void> {
  const swarm = swarmStates.get(swarmId);
  if (!swarm) {
    throw new Error(`Swarm ${swarmId} not found`);
  }
  
  // Simple monitoring loop
  let running = true;
  const interval = setInterval(() => {
    if (!running) {
      clearInterval(interval);
      return;
    }
    
    const agentsList = swarm.agents instanceof Map ? Array.from(swarm.agents.values()) : swarm.agents;
    console.log(`[MONITOR] Swarm ${swarmId} - Agents: ${agentsList.length}`);
    console.log(`[MONITOR] Active: ${agentsList.filter((a: any) => a.status === 'active').length}`);
  }, 5000);
  
  // Stop monitoring after timeout
  setTimeout(() => {
    running = false;
  }, 60 * 60 * 1000); // 1 hour
}

export function getSwarmState(swarmId: string): SwarmState | undefined {
  return swarmStates.get(swarmId);
}