import { type Node, type Connection, type Edge } from '@xyflow/react';
import { detectCycles } from './graph-validator';

interface ConnectionRule {
  sourceType: string;
  sourceHandle?: string;
  targetType: string;
  targetHandle?: string;
  description: string;
}

// Define valid connection rules
const connectionRules: ConnectionRule[] = [
  // Input nodes can connect to agents
  {
    sourceType: 'input',
    sourceHandle: 'output',
    targetType: 'agent',
    targetHandle: 'user-input',
    description: 'Input can provide user input to agent',
  },
  
  // Tools can connect to agents
  {
    sourceType: 'tool',
    sourceHandle: 'tool-output',
    targetType: 'agent',
    targetHandle: 'tools',
    description: 'Tools can be attached to agents',
  },
  
  // Custom tools can connect to agents
  {
    sourceType: 'custom-tool',
    sourceHandle: 'tool-output',
    targetType: 'agent',
    targetHandle: 'tools',
    description: 'Custom tools can be attached to agents',
  },
  
  // MCP tools can connect to agents
  {
    sourceType: 'mcp-tool',
    sourceHandle: 'mcp-tools',
    targetType: 'agent',
    targetHandle: 'tools',
    description: 'MCP server tools can be attached to agents',
  },
  
  // Agents can connect to outputs
  {
    sourceType: 'agent',
    sourceHandle: 'output',
    targetType: 'output',
    targetHandle: 'input',
    description: 'Agent output can connect to output nodes',
  },

  // ORCHESTRATOR AGENT CONNECTIONS
  
  // Input nodes can connect to orchestrator agents
  {
    sourceType: 'input',
    sourceHandle: 'output',
    targetType: 'orchestrator-agent',
    targetHandle: 'user-input',
    description: 'Input can provide user input to orchestrator agent',
  },
  
  // Tools can connect to orchestrator agents
  {
    sourceType: 'tool',
    sourceHandle: 'tool-output',
    targetType: 'orchestrator-agent',
    targetHandle: 'tools',
    description: 'Tools can be attached to orchestrator agents',
  },
  
  // Custom tools can connect to orchestrator agents
  {
    sourceType: 'custom-tool',
    sourceHandle: 'tool-output',
    targetType: 'orchestrator-agent',
    targetHandle: 'tools',
    description: 'Custom tools can be attached to orchestrator agents',
  },
  
  // MCP tools can connect to orchestrator agents
  {
    sourceType: 'mcp-tool',
    sourceHandle: 'mcp-tools',
    targetType: 'orchestrator-agent',
    targetHandle: 'tools',
    description: 'MCP server tools can be attached to orchestrator agents',
  },
  
  // Orchestrator agents can connect to regular agents (key feature)
  {
    sourceType: 'orchestrator-agent',
    sourceHandle: 'sub-agents',
    targetType: 'agent',
    targetHandle: 'orchestrator-input',
    description: 'Orchestrator agent can coordinate regular agents as tools',
  },
  
  // Orchestrator agents can connect to outputs
  {
    sourceType: 'orchestrator-agent',
    sourceHandle: 'output',
    targetType: 'output',
    targetHandle: 'input',
    description: 'Orchestrator agent output can connect to output nodes',
  },
  
  // HIERARCHICAL ORCHESTRATOR CONNECTIONS

  // Orchestrator agents can connect to other orchestrator agents (hierarchical structure)
  {
    sourceType: 'orchestrator-agent',
    sourceHandle: 'sub-agents',
    targetType: 'orchestrator-agent',
    targetHandle: 'orchestrator-input',
    description: 'Orchestrator agent can coordinate other orchestrator agents hierarchically',
  },

  // SWARM NODE CONNECTIONS

  // Input nodes can connect to swarm nodes
  {
    sourceType: 'input',
    sourceHandle: 'output',
    targetType: 'swarm',
    targetHandle: 'user-input',
    description: 'Input can provide user input to swarm',
  },

  // Swarm nodes can connect to agent nodes (agents become part of the swarm)
  {
    sourceType: 'swarm',
    sourceHandle: 'sub-agents',
    targetType: 'agent',
    targetHandle: 'orchestrator-input',
    description: 'Swarm can include agents as swarm members',
  },

  // Swarm nodes can connect to output nodes
  {
    sourceType: 'swarm',
    sourceHandle: 'output',
    targetType: 'output',
    targetHandle: 'input',
    description: 'Swarm output can connect to output nodes',
  },

  // GRAPH MODE: Agent-to-Agent Dependency Connections (within GraphBuilder container)
  // These connections define execution dependencies in graph mode
  // Agent A → Agent B means B depends on A's output (A executes before B)
  {
    sourceType: 'agent',
    sourceHandle: 'output',
    targetType: 'agent',
    targetHandle: 'user-input',
    description: 'Agent dependency: target agent depends on source agent output (Graph Mode)',
  },

  // Orchestrator agents can also be graph nodes
  {
    sourceType: 'agent',
    sourceHandle: 'output',
    targetType: 'orchestrator-agent',
    targetHandle: 'user-input',
    description: 'Agent to orchestrator dependency (Graph Mode)',
  },

  {
    sourceType: 'orchestrator-agent',
    sourceHandle: 'output',
    targetType: 'agent',
    targetHandle: 'user-input',
    description: 'Orchestrator to agent dependency (Graph Mode)',
  },

  {
    sourceType: 'orchestrator-agent',
    sourceHandle: 'output',
    targetType: 'orchestrator-agent',
    targetHandle: 'user-input',
    description: 'Orchestrator to orchestrator dependency (Graph Mode)',
  },

  // Swarm nodes can also be graph nodes
  {
    sourceType: 'swarm',
    sourceHandle: 'output',
    targetType: 'agent',
    targetHandle: 'user-input',
    description: 'Swarm to agent dependency (Graph Mode)',
  },

  {
    sourceType: 'agent',
    sourceHandle: 'output',
    targetType: 'swarm',
    targetHandle: 'user-input',
    description: 'Agent to swarm dependency (Graph Mode)',
  },

  {
    sourceType: 'swarm',
    sourceHandle: 'output',
    targetType: 'orchestrator-agent',
    targetHandle: 'user-input',
    description: 'Swarm to orchestrator dependency (Graph Mode)',
  },

  {
    sourceType: 'orchestrator-agent',
    sourceHandle: 'output',
    targetType: 'swarm',
    targetHandle: 'user-input',
    description: 'Orchestrator to swarm dependency (Graph Mode)',
  },

  {
    sourceType: 'swarm',
    sourceHandle: 'output',
    targetType: 'swarm',
    targetHandle: 'user-input',
    description: 'Swarm to swarm dependency (Graph Mode)',
  },

];

/**
 * Checks if an MCP tool node is already connected to an agent
 * @param mcpNodeId The ID of the MCP tool node
 * @param edges All existing edges in the flow
 * @returns the connected agent node ID if connected, null otherwise
 */
export function getMCPConnectedAgent(mcpNodeId: string, edges: Edge[]): string | null {
  const connection = edges.find(edge => 
    edge.source === mcpNodeId && 
    edge.sourceHandle === 'mcp-tools'
  );
  return connection ? connection.target : null;
}

/**
 * Gets all MCP tool nodes that are connected to a specific agent
 * @param agentNodeId The ID of the agent node
 * @param edges All existing edges in the flow
 * @returns array of MCP tool node IDs connected to this agent
 */
export function getAgentConnectedMCPTools(agentNodeId: string, edges: Edge[]): string[] {
  return edges
    .filter(edge => 
      edge.target === agentNodeId && 
      edge.sourceHandle === 'mcp-tools' &&
      edge.targetHandle === 'tools'
    )
    .map(edge => edge.source);
}

/**
 * Detects circular dependencies in orchestrator hierarchies
 * @param connection The proposed connection
 * @param nodes All nodes in the flow
 * @param edges All existing edges in the flow  
 * @returns true if the connection would create a circular dependency
 */
export function wouldCreateCircularDependency(
  connection: Connection,
  nodes: Node[],
  edges: Edge[]
): boolean {
  // Only check for orchestrator-to-orchestrator connections
  const sourceNode = nodes.find(node => node.id === connection.source);
  const targetNode = nodes.find(node => node.id === connection.target);
  
  if (!sourceNode || !targetNode || 
      sourceNode.type !== 'orchestrator-agent' || 
      targetNode.type !== 'orchestrator-agent') {
    return false;
  }
  
  // Check if target can already reach source through existing connections
  return canReachNode(targetNode.id, sourceNode.id, edges, nodes);
}

/**
 * Helper function to check if one node can reach another through existing connections
 * Uses depth-first search to traverse the orchestrator hierarchy
 * @param fromId Starting node ID
 * @param toId Target node ID to find
 * @param edges All edges in the flow
 * @param nodes All nodes in the flow
 * @param visited Set of visited node IDs to prevent infinite loops
 * @returns true if fromId can reach toId
 */
function canReachNode(
  fromId: string, 
  toId: string, 
  edges: Edge[], 
  nodes: Node[], 
  visited: Set<string> = new Set()
): boolean {
  if (fromId === toId) {
    return true;
  }
  
  if (visited.has(fromId)) {
    return false;
  }
  
  visited.add(fromId);
  
  // Find all orchestrator-agent nodes that this orchestrator connects to via sub-agents
  const outgoingEdges = edges.filter(
    edge => edge.source === fromId && 
           edge.sourceHandle === 'sub-agents'
  );
  
  for (const edge of outgoingEdges) {
    const targetNode = nodes.find(node => node.id === edge.target);
    if (targetNode?.type === 'orchestrator-agent') {
      if (canReachNode(edge.target, toId, edges, nodes, visited)) {
        return true;
      }
    }
  }
  
  return false;
}

export function isValidConnection(
  connection: Connection,
  nodes: Node[],
  edges: Edge[] = [],
  graphMode: boolean = false
): { valid: boolean; message?: string } {
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);

  if (!sourceNode || !targetNode) {
    return { valid: false, message: 'Source or target node not found' };
  }

  // Special validation for input nodes based on input type
  if (sourceNode.type === 'input' && (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent' || targetNode.type === 'swarm')) {
    const inputType = sourceNode.data?.inputType || 'user-prompt';
    const targetHandle = connection.targetHandle;
    
    // User prompt inputs should only connect to user-input handle
    if (inputType === 'user-prompt' && targetHandle !== 'user-input') {
      return {
        valid: false,
        message: 'User prompt inputs can only connect to the user input handle (blue)'
      };
    }
    
    // Data and variable inputs should also connect to user-input handle for now
    if ((inputType === 'data' || inputType === 'variable') && targetHandle !== 'user-input') {
      return {
        valid: false,
        message: 'Data and variable inputs should connect to the user input handle (blue)'
      };
    }
    
  }

  // Check if the connection matches any valid rule
  const matchingRule = connectionRules.find((rule) => {
    const typeMatch = 
      rule.sourceType === sourceNode.type && 
      rule.targetType === targetNode.type;
    
    const handleMatch = 
      (!rule.sourceHandle || rule.sourceHandle === connection.sourceHandle) &&
      (!rule.targetHandle || rule.targetHandle === connection.targetHandle);
    
    return typeMatch && handleMatch;
  });

  if (!matchingRule) {
    return {
      valid: false,
      message: `Invalid connection: ${sourceNode.type} cannot connect to ${targetNode.type}`,
    };
  }

  // Additional validation rules

  // Prevent self-connections
  if (connection.source === connection.target) {
    return { valid: false, message: 'Nodes cannot connect to themselves' };
  }

  // Explicit validation: Tools and MCP tools cannot connect to swarm nodes
  // This enforces the architectural principle that swarms coordinate agents but don't have tools themselves
  if (targetNode.type === 'swarm' &&
      (sourceNode.type === 'tool' || sourceNode.type === 'custom-tool' || sourceNode.type === 'mcp-tool')) {
    return {
      valid: false,
      message: 'Tools cannot connect to swarm nodes. Connect tools to individual agent nodes within the swarm instead.'
    };
  }
  
  // Prevent circular dependencies in orchestrator hierarchies
  if (wouldCreateCircularDependency(connection, nodes, edges)) {
    return {
      valid: false,
      message: 'This connection would create a circular dependency in the orchestrator hierarchy'
    };
  }

  // In graph mode, enforce special rules
  if (graphMode) {
    // Rule 1: Input nodes can ONLY connect to entry point agents (agents with no incoming dependencies)
    if (sourceNode.type === 'input' &&
        (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent' || targetNode.type === 'swarm')) {

      // Check if target agent has incoming dependencies from other agents
      const hasIncomingAgentDependencies = edges.some(edge => {
        const edgeSource = nodes.find(n => n.id === edge.source);
        return edge.target === targetNode.id &&
               (edgeSource?.type === 'agent' || edgeSource?.type === 'orchestrator-agent' || edgeSource?.type === 'swarm') &&
               edge.sourceHandle === 'output' &&
               edge.targetHandle === 'user-input';
      });

      if (hasIncomingAgentDependencies) {
        return {
          valid: false,
          message: 'Input nodes can only connect to entry point agents (agents with no incoming dependencies from other agents).'
        };
      }
    }

    // Rule 2: Validate agent→agent connections for cycles
    if ((sourceNode.type === 'agent' || sourceNode.type === 'orchestrator-agent' || sourceNode.type === 'swarm') &&
        (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent' || targetNode.type === 'swarm') &&
        connection.sourceHandle === 'output' &&
        connection.targetHandle === 'user-input') {

      // Simulate the connection and check for cycles
      const simulatedEdges = [...edges, {
        id: 'temp',
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      } as Edge];

      const cycles = detectCycles(nodes, simulatedEdges);
      if (cycles.length > 0) {
        return {
          valid: false,
          message: 'This connection would create a circular dependency. Graphs must be acyclic (DAG).'
        };
      }
    }
  }

  // MCP tool nodes can only connect to one agent node
  if (sourceNode.type === 'mcp-tool') {
    const connectedAgentId = getMCPConnectedAgent(connection.source, edges);
    
    if (connectedAgentId) {
      const connectedAgent = nodes.find(node => node.id === connectedAgentId);
      const agentLabel = connectedAgent?.data?.label || `Agent ${connectedAgentId.slice(-4)}`;
      
      return {
        valid: false,
        message: `MCP server "${sourceNode.data?.label || sourceNode.data?.serverName || 'Unnamed'}" is already connected to "${agentLabel}". Each MCP server can only connect to one agent node.`
      };
    }
  }

  // Prevent duplicate connections (same source handle to same target handle)
  const duplicateConnection = edges.find(edge => 
    edge.source === connection.source && 
    edge.target === connection.target &&
    edge.sourceHandle === connection.sourceHandle &&
    edge.targetHandle === connection.targetHandle
  );
  
  if (duplicateConnection) {
    return {
      valid: false,
      message: 'This connection already exists'
    };
  }

  return { valid: true };
}

export function getValidTargets(sourceNode: Node, sourceHandle?: string): string[] {
  return connectionRules
    .filter((rule) => {
      const typeMatch = rule.sourceType === sourceNode.type;
      const handleMatch = !rule.sourceHandle || rule.sourceHandle === sourceHandle;
      return typeMatch && handleMatch;
    })
    .map((rule) => rule.targetType);
}

export function getConnectionMessage(
  sourceNode: Node,
  targetNode: Node,
  sourceHandle?: string,
  targetHandle?: string
): string {
  const matchingRule = connectionRules.find((rule) => {
    const typeMatch = 
      rule.sourceType === sourceNode.type && 
      rule.targetType === targetNode.type;
    
    const handleMatch = 
      (!rule.sourceHandle || rule.sourceHandle === sourceHandle) &&
      (!rule.targetHandle || rule.targetHandle === targetHandle);
    
    return typeMatch && handleMatch;
  });

  return matchingRule?.description || 'Connection not allowed';
}