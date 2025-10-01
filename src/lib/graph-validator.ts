import { type Node, type Edge } from '@xyflow/react';

export interface GraphValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  entryPoints: string[];
  disconnectedAgents: string[];
  cycles: string[][];
}

/**
 * Detects circular dependencies in agent graph using DFS
 * @param nodes All nodes in the flow
 * @param edges All edges in the flow
 * @returns Array of cycles (each cycle is an array of node IDs)
 */
export function detectCycles(nodes: Node[], edges: Edge[]): string[][] {
  // Check all agent nodes
  const agentNodes = nodes.filter(n =>
    (n.type === 'agent' || n.type === 'orchestrator-agent' || n.type === 'swarm')
  );

  const cycles: string[][] = [];

  // Build adjacency list for agent→agent connections within the graph
  const adjList = new Map<string, string[]>();
  agentNodes.forEach(node => adjList.set(node.id, []));

  edges.forEach(edge => {
    const sourceNode = agentNodes.find(n => n.id === edge.source);
    const targetNode = agentNodes.find(n => n.id === edge.target);

    // Only consider agent→agent dependencies (not tool connections)
    if (sourceNode && targetNode &&
        edge.sourceHandle === 'output' &&
        edge.targetHandle === 'user-input') {
      const neighbors = adjList.get(edge.source) || [];
      neighbors.push(edge.target);
      adjList.set(edge.source, neighbors);
    }
  });

  // DFS with coloring: white (0), gray (1), black (2)
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  agentNodes.forEach(node => {
    color.set(node.id, 0); // white
    parent.set(node.id, null);
  });

  function dfs(nodeId: string, path: string[]): void {
    color.set(nodeId, 1); // gray - currently visiting
    path.push(nodeId);

    const neighbors = adjList.get(nodeId) || [];
    for (const neighborId of neighbors) {
      const neighborColor = color.get(neighborId);

      if (neighborColor === 1) {
        // Back edge found - cycle detected
        const cycleStart = path.indexOf(neighborId);
        const cycle = path.slice(cycleStart);
        cycle.push(neighborId); // Complete the cycle
        cycles.push(cycle);
      } else if (neighborColor === 0) {
        // White node - continue DFS
        parent.set(neighborId, nodeId);
        dfs(neighborId, [...path]);
      }
    }

    color.set(nodeId, 2); // black - fully processed
  }

  // Run DFS from each unvisited node
  agentNodes.forEach(node => {
    if (color.get(node.id) === 0) {
      dfs(node.id, []);
    }
  });

  return cycles;
}

/**
 * Finds entry point agents (agents with no incoming dependencies from other agents)
 * @param nodes All nodes in the flow
 * @param edges All edges in the flow
 * @returns Array of entry point agent IDs
 */
export function findEntryPoints(
  nodes: Node[],
  edges: Edge[]
): string[] {
  // Find all agents
  const agentNodes = nodes.filter(node =>
    (node.type === 'agent' || node.type === 'orchestrator-agent' || node.type === 'swarm')
  );

  // Entry points are agents with no incoming agent dependencies
  const agentsWithIncomingDeps = new Set<string>();

  edges.forEach(edge => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);

    // Check if this is an agent→agent dependency connection
    if (sourceNode && targetNode &&
        (sourceNode.type === 'agent' || sourceNode.type === 'orchestrator-agent' || sourceNode.type === 'swarm') &&
        (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent' || targetNode.type === 'swarm') &&
        edge.sourceHandle === 'output' &&
        edge.targetHandle === 'user-input') {
      agentsWithIncomingDeps.add(edge.target);
    }
  });

  // Entry points are agents without incoming dependencies
  return agentNodes
    .filter(node => !agentsWithIncomingDeps.has(node.id))
    .map(node => node.id);
}

/**
 * Finds agents that are disconnected from the graph (unreachable from entry points)
 * @param nodes All nodes in the flow
 * @param edges All edges in the flow
 * @param entryPoints Array of entry point agent IDs
 * @returns Array of disconnected agent IDs
 */
export function findDisconnectedAgents(
  nodes: Node[],
  edges: Edge[],
  entryPoints: string[]
): string[] {
  const agentNodes = nodes.filter(n => n.type === 'agent' || n.type === 'orchestrator-agent' || n.type === 'swarm');

  if (entryPoints.length === 0) {
    // If no entry points, all agents are considered disconnected
    return agentNodes.map(n => n.id);
  }

  // Build adjacency list
  const adjList = new Map<string, string[]>();
  agentNodes.forEach(node => adjList.set(node.id, []));

  edges.forEach(edge => {
    const sourceNode = agentNodes.find(n => n.id === edge.source);
    const targetNode = agentNodes.find(n => n.id === edge.target);

    if (sourceNode && targetNode &&
        edge.sourceHandle === 'output' &&
        edge.targetHandle === 'user-input') {
      const neighbors = adjList.get(edge.source) || [];
      neighbors.push(edge.target);
      adjList.set(edge.source, neighbors);
    }
  });

  // BFS from entry points to find reachable agents
  const reachable = new Set<string>();
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;

    reachable.add(nodeId);
    const neighbors = adjList.get(nodeId) || [];
    neighbors.forEach(neighbor => {
      if (!reachable.has(neighbor)) {
        queue.push(neighbor);
      }
    });
  }

  // Disconnected agents are those not reachable from entry points
  return agentNodes
    .filter(node => !reachable.has(node.id))
    .map(node => node.id);
}

/**
 * Validates graph structure and returns comprehensive validation result
 * @param nodes All nodes in the flow
 * @param edges All edges in the flow
 * @returns Validation result with errors, warnings, and details
 */
export function validateGraphStructure(nodes: Node[], edges: Edge[]): GraphValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for at least one agent
  const agentNodes = nodes.filter(n => n.type === 'agent' || n.type === 'orchestrator-agent' || n.type === 'swarm');
  if (agentNodes.length === 0) {
    errors.push('Graph requires at least one agent node');
  }

  // Check for at least one input node
  const inputNodes = nodes.filter(n => n.type === 'input');
  if (inputNodes.length === 0) {
    errors.push('Graph requires at least one input node to define entry points');
  }

  // Check that all entry points have input connections
  const entryPoints = findEntryPoints(nodes, edges);
  const entryPointsWithInput = new Set<string>();

  edges.forEach(edge => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    if (sourceNode?.type === 'input' && entryPoints.includes(edge.target)) {
      entryPointsWithInput.add(edge.target);
    }
  });

  entryPoints.forEach(entryPointId => {
    if (!entryPointsWithInput.has(entryPointId)) {
      const agent = nodes.find(n => n.id === entryPointId);
      const label = agent?.data?.label || entryPointId.slice(-4);
      warnings.push(`Entry point agent "${label}" has no input connection. Connect an input node to define how it receives data.`);
    }
  });

  // Detect circular dependencies
  const cycles = detectCycles(nodes, edges);
  if (cycles.length > 0) {
    const cycleDescriptions = cycles.map(cycle => {
      const labels = cycle.map(id => {
        const node = nodes.find(n => n.id === id);
        return node?.data?.label || id.slice(-4);
      });
      return labels.join(' → ');
    });
    errors.push(`Circular dependencies detected: ${cycleDescriptions.join('; ')}`);
  }

  // Entry points already found above
  if (entryPoints.length === 0) {
    warnings.push('No entry points detected. At least one agent should have no incoming agent dependencies.');
  }

  // Find disconnected agents
  const disconnectedAgents = findDisconnectedAgents(nodes, edges, entryPoints);
  if (disconnectedAgents.length > 0) {
    const labels = disconnectedAgents.map(id => {
      const node = nodes.find(n => n.id === id);
      return node?.data?.label || id.slice(-4);
    });
    warnings.push(`Disconnected agents (unreachable from entry points): ${labels.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    entryPoints,
    disconnectedAgents,
    cycles
  };
}
