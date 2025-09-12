import { type Node, type Connection } from '@xyflow/react';

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
  
];

export function isValidConnection(
  connection: Connection,
  nodes: Node[]
): { valid: boolean; message?: string } {
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);

  if (!sourceNode || !targetNode) {
    return { valid: false, message: 'Source or target node not found' };
  }

  // Special validation for input nodes based on input type
  if (sourceNode.type === 'input' && (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent')) {
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

  // Prevent duplicate connections (same source handle to same target handle)
  // This would need to be checked against existing edges in the actual implementation

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