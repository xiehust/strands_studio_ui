import { type Node, type Edge } from '@xyflow/react';

interface CodeGenerationResult {
  code: string;
  imports: string[];
  errors: string[];
}

export function generateStrandsAgentCode(
  nodes: Node[],
  edges: Edge[]
): CodeGenerationResult {
  const imports = new Set<string>([
    'from strands import Agent, tool',
    'from strands.models import BedrockModel',
    'from strands_tools import calculator, file_read, shell, current_time',
    'import json',
    'import os',
    'import asyncio',
    'import argparse'
  ]);
  
  // Check if MCP tools are used
  const hasMCPTools = nodes.some(node => node.type === 'mcp-tool');
  if (hasMCPTools) {
    imports.add('from strands.tools.mcp import MCPClient');
    imports.add('from mcp import stdio_client, StdioServerParameters');
    imports.add('from mcp.client.streamable_http import streamablehttp_client');
    imports.add('from mcp.client.sse import sse_client');
  }

  // Check if swarm nodes are used
  const hasSwarmNodes = nodes.some(node => node.type === 'swarm');
  if (hasSwarmNodes) {
    imports.add('from strands.multiagent import Swarm');
  }
  
  const errors: string[] = [];
  let code = '';

  try {
    // Find all node types
    const agentNodes = nodes.filter(node => node.type === 'agent');
    const orchestratorNodes = nodes.filter(node => node.type === 'orchestrator-agent');
    const swarmNodes = nodes.filter(node => node.type === 'swarm');
    const inputNodes = nodes.filter(node => node.type === 'input');
    const outputNodes = nodes.filter(node => node.type === 'output');
    
    // Check if any agents use OpenAI and add the import
    const allAgentNodes = [...agentNodes, ...orchestratorNodes];
    const hasOpenAIProvider = allAgentNodes.some(node => node.data?.modelProvider === 'OpenAI');
    if (hasOpenAIProvider) {
      imports.add('from strands.models.openai import OpenAIModel');
    }
    
    // Validate mandatory nodes
    if (agentNodes.length === 0 && orchestratorNodes.length === 0 && swarmNodes.length === 0) {
      errors.push('No agent nodes found. At least one agent, orchestrator agent, or swarm is required.');
    }
    
    if (inputNodes.length === 0) {
      errors.push('Input node is mandatory. Please add at least one input node to provide data to your agents.');
    }
    
    if (outputNodes.length === 0) {
      errors.push('Output node is mandatory. Please add at least one output node to display results from your agents.');
    }
    
    // Validate connections for mandatory nodes
    if (inputNodes.length > 0) {
      const connectedInputs = inputNodes.filter(inputNode =>
        edges.some(edge => edge.source === inputNode.id)
      );
      if (connectedInputs.length === 0) {
        errors.push('Input nodes must be connected to agents, orchestrator agents, or swarms. Please connect your input node to an agent, orchestrator agent, or swarm.');
      }
    }

    if (outputNodes.length > 0) {
      const connectedOutputs = outputNodes.filter(outputNode =>
        edges.some(edge => edge.target === outputNode.id)
      );
      if (connectedOutputs.length === 0) {
        errors.push('Output nodes must be connected to agents, orchestrator agents, or swarms. Please connect an agent, orchestrator agent, or swarm to your output node.');
      }
    }

    // Validate swarm connections
    if (swarmNodes.length > 0) {
      swarmNodes.forEach(swarmNode => {
        const connectedAgents = findConnectedSwarmAgents(swarmNode, agentNodes, edges);
        if (connectedAgents.length === 0) {
          errors.push(`Swarm "${swarmNode.data?.label || 'Unnamed'}" must be connected to at least one agent. Please connect agent nodes to this swarm.`);
        }
      });
    }
    
    // Return early if mandatory nodes are missing or not connected
    if (errors.length > 0) {
      return { code: '', imports: Array.from(imports), errors };
    }

    // Generate custom tool code first (needs to be before agents that use them)
    const customToolNodes = nodes.filter(node => node.type === 'custom-tool');
    if (customToolNodes.length > 0) {
      customToolNodes.forEach(toolNode => {
        const toolCode = generateCustomToolCode(toolNode);
        code += toolCode + '\n\n';
      });
    }

    // Generate MCP client setup code if needed
    if (hasMCPTools) {
      const mcpCode = generateMCPSetupCode(nodes);
      code += mcpCode + '\n\n';
    }

    // Generate agent-as-tool functions for orchestrator patterns
    if (orchestratorNodes.length > 0) {
      // Find agents connected to orchestrator agents
      const connectedAgentNodes = findConnectedSubAgents(orchestratorNodes, agentNodes, edges);
      
      connectedAgentNodes.forEach((agentNode, index) => {
        const agentAsToolCode = generateAgentAsToolCode(agentNode, nodes, edges, index);
        code += agentAsToolCode + '\n\n';
      });
      
      // Find orchestrators connected to other orchestrator agents (hierarchical)
      const connectedSubOrchestrators = findConnectedSubOrchestrators(orchestratorNodes, edges);
      
      connectedSubOrchestrators.forEach((orchestratorNode, index) => {
        const orchestratorAsToolCode = generateOrchestratorAsToolCode(orchestratorNode, nodes, edges, index + connectedAgentNodes.length);
        code += orchestratorAsToolCode + '\n\n';
      });
    }

    // Generate code for each regular agent (non-connected ones)
    // Always generate individual agents unless they are connected to orchestrators or swarms as sub-agents
    // Skip agents that have MCP tools connected since they will be created in main() with MCP context
    const unconnectedAgents = agentNodes.filter(agent =>
      !isAgentConnectedToOrchestrator(agent, orchestratorNodes, edges) &&
      !isAgentConnectedToSwarm(agent, swarmNodes, edges)
    );


    unconnectedAgents.forEach((agentNode, index) => {
      // Check if this agent has MCP tools connected
      const agentHasMCPTools = findConnectedMCPTools(agentNode, nodes, edges).length > 0;

      if (!agentHasMCPTools) {
        // Only generate global agent instance if it doesn't have MCP tools
        const agentCode = generateAgentCode(agentNode, nodes, edges, index);
        code += agentCode + '\n\n';
      } else {
        // For agents with MCP tools, only generate the model configuration
        const agentModelCode = generateAgentModelOnly(agentNode, nodes, edges, index);
        code += agentModelCode + '\n\n';
      }
    });

    // Generate orchestrator agent code
    // Find the execution agent to avoid duplication
    const executionAgent = findConnectedAgent(nodes, edges);

    orchestratorNodes.forEach((orchestratorNode, index) => {
      // Check if this orchestrator is the execution agent
      const isExecutionOrchestrator = executionAgent?.id === orchestratorNode.id;

      if (isExecutionOrchestrator) {
        // For execution orchestrators, only generate model configuration
        const orchestratorModelCode = generateOrchestratorModelOnly(orchestratorNode, nodes, edges, index);
        code += orchestratorModelCode + '\n\n';
      } else {
        // For non-execution orchestrators, generate full orchestrator instance
        const orchestratorCode = generateOrchestratorCode(orchestratorNode, nodes, edges, index);
        code += orchestratorCode + '\n\n';
      }
    });

    // Generate code for agents connected to swarms (must be done before swarm instantiation)
    if (swarmNodes.length > 0) {
      // Find all agents connected to swarms
      const swarmConnectedAgents = agentNodes.filter(agent =>
        isAgentConnectedToSwarm(agent, swarmNodes, edges)
      );

      swarmConnectedAgents.forEach((agentNode, index) => {
        // For swarm-connected agents, ALWAYS generate full Agent instances with name property
        // The swarm needs actual Agent objects with names for coordination
        // MCP tools will be handled at the swarm execution level
        const agentCode = generateSwarmAgentCode(agentNode, nodes, edges, index);
        code += agentCode + '\n\n';
      });
    }

    // Generate swarm code if swarm nodes exist
    if (swarmNodes.length > 0) {
      swarmNodes.forEach((swarmNode, index) => {
        const swarmCode = generateSwarmCode(swarmNode, agentNodes, nodes, edges, index);
        code += swarmCode + '\n\n';
      });
    }

    // Generate main execution code
    const allExecutableAgents = [...agentNodes, ...orchestratorNodes, ...swarmNodes];
    code += generateMainExecutionCode(allExecutableAgents, nodes, edges, hasMCPTools);

  } catch (error) {
    errors.push(`Code generation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    code: code.trim(),
    imports: Array.from(imports),
    errors,
  };
}

function generateAgentModelOnly(
  agentNode: Node,
  _allNodes: Node[],
  _edges: Edge[],
  index: number
): string {
  const data = agentNode.data || {};
  const {
    label = `Agent${index + 1}`,
    modelProvider = 'AWS Bedrock',
    modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    modelName = 'Claude 3.7 Sonnet',
    temperature = 0.7,
    maxTokens = 4000,
    baseUrl = '',
  } = data;

  // Use modelId for Bedrock, modelName for others
  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;

  // Sanitize agent name to be Python-compatible
  const agentVarName = sanitizePythonVariableName(label as string);

  // Generate model configuration based on provider
  const modelConfig = generateModelConfigForCode(agentVarName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string);

  return `# ${label} Configuration
${modelConfig}`;
}

function generateAgentCode(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[],
  index: number
): string {
  const data = agentNode.data || {};
  const {
    label = `Agent${index + 1}`,
    modelProvider = 'AWS Bedrock',
    modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    modelName = 'Claude 3.7 Sonnet',
    systemPrompt = 'You are a helpful AI assistant.',
    temperature = 0.7,
    maxTokens = 4000,
    baseUrl = '',
  } = data;

  // Use modelId for Bedrock, modelName for others
  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;
  
  // Sanitize agent name to be Python-compatible
  const agentVarName = sanitizePythonVariableName(label as string);

  // Find connected tools
  const connectedTools = findConnectedTools(agentNode, allNodes, edges);
  const toolsCode = connectedTools.length > 0 
    ? `,\n    tools=[${connectedTools.map(tool => tool.code).join(', ')}]`
    : '';

  // System prompt comes from agent property panel only (no input connections)
  const systemPromptValue = systemPrompt;

  // Generate model configuration based on provider
  const modelConfig = generateModelConfigForCode(agentVarName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string);

  return `# ${label} Configuration
${modelConfig}

${agentVarName} = Agent(
    model=${agentVarName}_model,
    system_prompt="""${systemPromptValue}"""${toolsCode},
    callback_handler=None
)`;
}

function generateSwarmAgentCode(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[],
  index: number
): string {
  const data = agentNode.data || {};
  const {
    label = `Agent${index + 1}`,
    modelProvider = 'AWS Bedrock',
    modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    modelName = 'Claude 3.7 Sonnet',
    systemPrompt = 'You are a helpful AI assistant.',
    temperature = 0.7,
    maxTokens = 4000,
    baseUrl = '',
  } = data;

  // Use modelId for Bedrock, modelName for others
  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;

  // Sanitize agent name to be Python-compatible
  const agentVarName = sanitizePythonVariableName(label as string);

  // Find connected tools
  const connectedTools = findConnectedTools(agentNode, allNodes, edges);
  const toolsCode = connectedTools.length > 0
    ? `,\n    tools=[${connectedTools.map(tool => tool.code).join(', ')}]`
    : '';

  // System prompt comes from agent property panel only (no input connections)
  const systemPromptValue = systemPrompt;

  // Generate model configuration based on provider
  const modelConfig = generateModelConfigForCode(agentVarName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string);

  return `# ${label} Configuration
${modelConfig}

${agentVarName} = Agent(
    name="${label}",
    model=${agentVarName}_model,
    system_prompt="""${systemPromptValue}"""${toolsCode},
    callback_handler=None
)`;
}

function generateMCPSetupCode(nodes: Node[]): string {
  const mcpNodes = nodes.filter(node => node.type === 'mcp-tool');
  if (mcpNodes.length === 0) return '';

  let mcpCode = '# MCP Client Setup\n';
  
  mcpNodes.forEach((mcpNode, index) => {
    const data = mcpNode.data || {};
    const {
      serverName = `mcp_server_${index + 1}`,
      transportType = 'stdio',
      command = 'uvx',
      args = [],
      url = 'http://localhost:8000/mcp',
      env = {},
      timeout = 30
    } = data;

    const clientVarName = `${(serverName as string).toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${mcpNode.id.slice(-4)}`;

    mcpCode += `\n# ${serverName} MCP Client\n`;
    
    switch (transportType) {
      case 'stdio': {
        const argsStr = (args as string[]).length > 0 ? JSON.stringify(args) : '[]';
        const envStr = Object.keys(env as object).length > 0 ? `,\n        env=${JSON.stringify(env)}` : '';
        mcpCode += `${clientVarName} = MCPClient(
    lambda: stdio_client(
        StdioServerParameters(
            command="${command}",
            args=${argsStr}${envStr}
        )
    ),
    startup_timeout=${timeout}
)\n`;
        break;
      }
        
      case 'streamable_http':
        mcpCode += `${clientVarName} = MCPClient(
    lambda: streamablehttp_client("${url}"),
    startup_timeout=${timeout}
)\n`;
        break;
        
      case 'sse':
        mcpCode += `${clientVarName} = MCPClient(
    lambda: sse_client("${url}"),
    startup_timeout=${timeout}
)\n`;
        break;
    }
  });

  return mcpCode;
}

function findConnectedTools(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[]
): Array<{ node: Node; code: string }> {
  const connectedToolEdges = edges.filter(
    edge => edge.target === agentNode.id && (edge.targetHandle === 'tools' || edge.targetHandle === 'mcp-tools')
  );
  
  return connectedToolEdges.map(edge => {
    const toolNode = allNodes.find(node => node.id === edge.source);
    if (!toolNode) return { node: {} as Node, code: '' };
    
    const toolData = toolNode.data || {};
    
    if (toolNode.type === 'tool') {
      const toolName = (toolData.toolName as string) || 'calculator';
      // Map common tool names to strands_tools
      const toolMapping: Record<string, string> = {
        'calculator': 'calculator',
        'file_read': 'file_read',
        'file_reader': 'file_read', // alias for file_read
        'shell': 'shell',
        'current_time': 'current_time',
        'web_search': 'calculator', // fallback to calculator for demo
        'api_caller': 'calculator', // fallback to calculator for demo
        'database_query': 'calculator', // fallback to calculator for demo
        'email_sender': 'calculator', // fallback to calculator for demo
      };
      const mappedTool = toolMapping[toolName] || 'calculator';
      return {
        node: toolNode,
        code: mappedTool,
      };
    } else if (toolNode.type === 'custom-tool') {
      // Extract function name from Python code
      const pythonCode = (toolData.pythonCode as string) || '';
      const functionName = extractFunctionName(pythonCode) || 'custom_tool';
      return {
        node: toolNode,
        code: `${functionName}`,  // Use extracted function name
      };
    } else if (toolNode.type === 'mcp-tool') {
      // MCP tools are handled separately - don't include in regular tools
      return {
        node: toolNode,
        code: '',  // Don't include MCP tools in regular tools list
      };
    }
    
    return { node: toolNode, code: '' };
  }).filter(tool => tool.code !== '');
}

function findConnectedMCPTools(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[]
): Node[] {
  const connectedToolEdges = edges.filter(
    edge => edge.target === agentNode.id && (edge.targetHandle === 'tools' || edge.targetHandle === 'mcp-tools')
  );
  
  return connectedToolEdges
    .map(edge => allNodes.find(node => node.id === edge.source))
    .filter((node): node is Node => node?.type === 'mcp-tool');
}



function findConnectedAgent(
  allNodes: Node[],
  edges: Edge[]
): Node | null {
  // Find input nodes
  const inputNodes = allNodes.filter(node => node.type === 'input');

  // Find agents/swarms connected to input nodes
  for (const inputNode of inputNodes) {
    const connectedEdges = edges.filter(edge => edge.source === inputNode.id);
    for (const edge of connectedEdges) {
      const targetNode = allNodes.find(node => node.id === edge.target);
      if (targetNode && (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent' || targetNode.type === 'swarm')) {
        return targetNode;
      }
    }
  }

  // Fallback: return first agent/orchestrator/swarm if no connections found
  const allExecutables = allNodes.filter(node => node.type === 'agent' || node.type === 'orchestrator-agent' || node.type === 'swarm');
  return allExecutables.length > 0 ? allExecutables[0] : null;
}

function generateMainExecutionCode(
  _agentNodes: Node[],
  allNodes: Node[],
  edges: Edge[],
  hasMCPTools: boolean = false
): string {
  const mcpNodes = allNodes.filter(node => node.type === 'mcp-tool');
  
  let mainCode = `# Main execution
async def main(user_input_arg: str = None, messages_arg: str = None):`;

  // Find the agent that should be executed (connected to input)
  const executionAgent = findConnectedAgent(allNodes, edges);

  // Initialize variables for MCP and swarm integration (before they're used)
  let swarmAgentMCPConnections: Array<{agent: Node, mcpTools: Node[]}> = [];
  let executionAgentMcpClientVars: string[] = [];

  if (!executionAgent) {
    return mainCode + `
    print("No agent found to execute")
    return ""

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Agent')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))`;
  }

  if (hasMCPTools) {
    // For swarms, use pre-calculated MCP connections to agents within the swarm
    // For regular agents, check MCP tools directly connected to execution agent
    let executionAgentMCPTools: Node[] = [];

    if (executionAgent.type === 'swarm') {
      // Use pre-calculated swarm agent MCP connections
      swarmAgentMCPConnections.forEach(({mcpTools}) => {
        executionAgentMCPTools.push(...mcpTools);
      });
    } else {
      // Regular agent - check direct MCP connections
      executionAgentMCPTools = findConnectedMCPTools(executionAgent, allNodes, edges);
    }

    executionAgentMcpClientVars = executionAgentMCPTools.map(node => {
      const serverName = (node.data?.serverName as string) || 'mcp_server';
      return `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${node.id.slice(-4)}`;
    });
    
    // All MCP clients need to be in global scope for sub-agents
    const allMcpClientVars = mcpNodes.map(node => {
      const serverName = (node.data?.serverName as string) || 'mcp_server';
      return `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${node.id.slice(-4)}`;
    });
    
    // Include custom tool function names in globals for MCP mode
    const customToolNodes = allNodes.filter(node => node.type === 'custom-tool');
    const customToolGlobals = customToolNodes.map(node => {
      const pythonCode = (node.data?.pythonCode as string) || '';
      return extractFunctionName(pythonCode) || 'custom_tool';
    });

    // For swarms, add agent names to globals if they have MCP connections
    const swarmAgentGlobals = swarmAgentMCPConnections.map(({agent}) => {
      const agentLabel = (agent.data?.label as string) || 'agent';
      return sanitizePythonVariableName(agentLabel);
    });

    const allGlobals = [...allMcpClientVars, ...customToolGlobals, ...swarmAgentGlobals];
    
    if (allGlobals.length > 0) {
      mainCode += `
    global ${allGlobals.join(', ')}`;
    }

    mainCode += `

    # Use MCP clients in context managers (only those connected to execution agent)
    ${executionAgentMcpClientVars.length > 0 
      ? `with ${executionAgentMcpClientVars.join(', ')}:
        # Get tools from MCP servers
        mcp_tools = []`
      : `# No MCP tools connected to execution agent
    mcp_tools = []`}`;
    
    // Add tool collection only from MCP clients directly connected to execution agent
    executionAgentMcpClientVars.forEach(clientVar => {
      mainCode += `
        mcp_tools.extend(${clientVar}.list_tools_sync())`;
    });
    
    // Generate agent creation inside context manager using the connected agent
    const agentData = executionAgent.data || {};
    const {
      label = 'Agent1',
      systemPrompt = 'You are a helpful AI assistant.',
      coordinationPrompt = '',
    } = agentData;
    // Sanitize agent name to be Python-compatible  
    const agentName = sanitizePythonVariableName(label as string);
    
    // Check the type of execution agent
    const isOrchestrator = executionAgent.type === 'orchestrator-agent';
    const isSwarm = executionAgent.type === 'swarm';

    if (isSwarm) {
      // For swarm nodes, no need to create an agent - the swarm is already created globally
      // Swarms are instantiated with their connected agents during swarm code generation
      const indentation = executionAgentMcpClientVars.length > 0 ? '        ' : '    ';
      mainCode += `
${indentation}# Swarm ${agentName} is already configured with its agents`;
    } else if (isOrchestrator) {
      // For orchestrator agents, create with sub-agents and sub-orchestrators and tools
      const subAgentEdges = edges.filter(
        edge => edge.source === executionAgent.id && edge.sourceHandle === 'sub-agents'
      );
      const subNodes = subAgentEdges.map(edge => 
        allNodes.find(node => node.id === edge.target)
      ).filter(Boolean);
      
      const subFunctions = subNodes.map(subNode => {
        const labelText = (subNode!.data?.label as string) || 'node';
        const baseName = sanitizePythonVariableName(labelText);
        return `${baseName}_${subNode!.id.slice(-4)}`;
      });
      
      // Find connected non-MCP tools and MCP tools
      const connectedTools = findConnectedTools(executionAgent, allNodes, edges);
      const connectedMCPTools = findConnectedMCPTools(executionAgent, allNodes, edges);
      const regularToolsList = connectedTools.map(tool => tool.code);
      const allRegularTools = [...regularToolsList, ...subFunctions];
      
      // Only include mcp_tools if orchestrator has direct MCP connections
      // If only sub-agents have MCP tools, they handle their own MCP context
      const orchestratorHasDirectMCPTools = connectedMCPTools.length > 0;
      const toolsArrayCode = orchestratorHasDirectMCPTools
        ? (allRegularTools.length > 0 
           ? `mcp_tools + [${allRegularTools.join(', ')}]`
           : 'mcp_tools')
        : (allRegularTools.length > 0
           ? `[${allRegularTools.join(', ')}]`
           : '[]');
      
      const fullSystemPrompt = coordinationPrompt 
        ? `${systemPrompt}\\n\\nCoordination Instructions: ${coordinationPrompt}`
        : systemPrompt;
      
      const indentation = executionAgentMcpClientVars.length > 0 ? '        ' : '    ';
      mainCode += `
${indentation}
${indentation}# Create orchestrator agent ${executionAgentMcpClientVars.length > 0 ? 'with MCP tools' : ''}
${indentation}${agentName} = Agent(
${indentation}    model=${agentName}_model,
${indentation}    system_prompt="""${fullSystemPrompt}""",
${indentation}    tools=${toolsArrayCode},
${indentation}    callback_handler=None
${indentation})`;
    } else {
      // Regular agent
      const connectedTools = findConnectedTools(executionAgent, allNodes, edges);
      const nonMCPTools = connectedTools.filter(tool => tool.node.type !== 'mcp-tool');
      const regularToolsList = nonMCPTools.map(tool => tool.code);
      const toolsArrayCode = regularToolsList.length > 0
        ? `mcp_tools + [${regularToolsList.join(', ')}]`
        : 'mcp_tools';

      const indentation = executionAgentMcpClientVars.length > 0 ? '        ' : '    ';
      mainCode += `
${indentation}
${indentation}# Create agent ${executionAgentMcpClientVars.length > 0 ? 'with MCP tools' : ''}
${indentation}${agentName} = Agent(
${indentation}    model=${agentName}_model,
${indentation}    system_prompt="""${systemPrompt}""",
${indentation}    tools=${toolsArrayCode},
${indentation}    callback_handler=None
${indentation})`;
    }
  } else {
    // Sanitize agent names for global variables using connected agent
    const executionAgentName = sanitizePythonVariableName((executionAgent.data?.label as string) || 'agent1');
    
    mainCode += `
    # Access the global variables
    global ${executionAgentName}`;
  }

  // Determine indentation based on whether execution agent has MCP tools
  // For swarms, check if any agents within the swarm have MCP tools
  let executionAgentHasMCPTools = false;
  if (executionAgent.type === 'swarm') {
    // Check if any agents within the swarm have MCP tools
    executionAgentHasMCPTools = hasMCPTools && swarmAgentMCPConnections.length > 0;
  } else {
    // Regular agent - check direct MCP connections
    executionAgentHasMCPTools = hasMCPTools && findConnectedMCPTools(executionAgent, allNodes, edges).length > 0;
  }
  const baseIndent = executionAgentHasMCPTools ? '        ' : '    ';
  
  // Generate execution for the connected agent
  const label = (executionAgent.data?.label as string) || 'agent1';
  const agentName = sanitizePythonVariableName(label);

  // For swarms, detect MCP connections to agents within the swarm
  if (executionAgent.type === 'swarm') {
    const swarmConnectedAgents = allNodes.filter(node =>
      node.type === 'agent' && isAgentConnectedToSwarm(node, [executionAgent], edges)
    );

    swarmConnectedAgents.forEach(agent => {
      const agentMCPTools = findConnectedMCPTools(agent, allNodes, edges);
      if (agentMCPTools.length > 0) {
        swarmAgentMCPConnections.push({agent, mcpTools: agentMCPTools});
      }
    });
  }
  // Generate user input logic
  if (executionAgent.type === 'swarm'){
    //swarm __call__ can only support str | list[ContentBlock]. 
    // https://strandsagents.com/latest/documentation/docs/api-reference/multiagent/#strands.multiagent.swarm.Swarm
    mainCode += `
${baseIndent}# User input from command-line arguments with priority: --messages > --user-input > default
${baseIndent}if messages_arg is not None and messages_arg.strip():
${baseIndent}    # Parse messages JSON and pass full conversation history to agent
${baseIndent}    try:
${baseIndent}        messages_list = json.loads(messages_arg)
${baseIndent}        # Pass the full messages list to the agent
${baseIndent}        user_input = messages_list[-1]['content']
${baseIndent}    except (json.JSONDecodeError, KeyError, TypeError):
${baseIndent}        user_input = "Hello, how can you help me?"
${baseIndent}elif user_input_arg is not None and user_input_arg.strip():
${baseIndent}    user_input = user_input_arg.strip()
${baseIndent}else:
${baseIndent}    # Default fallback when no input provided
${baseIndent}    user_input = "Hello, how can you help me?"`;
  }else{
    mainCode += `
${baseIndent}# User input from command-line arguments with priority: --messages > --user-input > default
${baseIndent}if messages_arg is not None and messages_arg.strip():
${baseIndent}    # Parse messages JSON and pass full conversation history to agent
${baseIndent}    try:
${baseIndent}        messages_list = json.loads(messages_arg)
${baseIndent}        # Pass the full messages list to the agent
${baseIndent}        user_input = messages_list
${baseIndent}    except (json.JSONDecodeError, KeyError, TypeError):
${baseIndent}        user_input = "Hello, how can you help me?"
${baseIndent}elif user_input_arg is not None and user_input_arg.strip():
${baseIndent}    user_input = user_input_arg.strip()
${baseIndent}else:
${baseIndent}    # Default fallback when no input provided
${baseIndent}    user_input = "Hello, how can you help me?"`;
        
  }
    const executionAgentData = executionAgent.data || {};
    const isStreaming = executionAgentData.streaming || false;

    if (executionAgent.type === 'swarm') {
      // Swarm execution (always synchronous)

      // Check if we need MCP context for swarm agents
      const swarmHasMCPTools = swarmAgentMCPConnections.length > 0;

      if (swarmHasMCPTools) {
        // Collect all unique MCP client variables needed for the swarm
        const swarmMcpClientVars = new Set<string>();
        swarmAgentMCPConnections.forEach(({mcpTools}) => {
          mcpTools.forEach(mcpTool => {
            const serverName = (mcpTool.data?.serverName as string) || 'mcp_server';
            const clientVar = `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${mcpTool.id.slice(-4)}`;
            swarmMcpClientVars.add(clientVar);
          });
        });

        mainCode += `
${baseIndent}# Use MCP clients in context managers for swarm agents
${baseIndent}with ${Array.from(swarmMcpClientVars).join(', ')}:`;

        // Add MCP tool assignment for each agent that has MCP connections
        swarmAgentMCPConnections.forEach(({agent, mcpTools}) => {
          const agentVarName = sanitizePythonVariableName((agent.data?.label as string) || 'agent');

          // Collect all MCP tools for this agent
          const mcpToolVars: string[] = [];
          mcpTools.forEach(mcpTool => {
            const serverName = (mcpTool.data?.serverName as string) || 'mcp_server';
            const clientVar = `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${mcpTool.id.slice(-4)}`;
            const toolVar = `tools_${mcpTool.id.slice(-4)}`;
            mcpToolVars.push(toolVar);
            mainCode += `
${baseIndent}    # Initialize tools from MCP client ${serverName}
${baseIndent}    ${toolVar} = ${clientVar}.list_tools_sync()`;
          });

          // Combine existing tools with MCP tools for this agent
          mainCode += `
${baseIndent}    # Combine existing tools with MCP tools for agent ${agent.data?.label || 'agent'}`;
          mcpToolVars.forEach(toolVar => {
            mainCode += `
${baseIndent}    ${agentVarName}.tool_registry.process_tools(${toolVar})`;
          });
        });

        mainCode += `
${baseIndent}    # Execute swarm (sync execution)
${baseIndent}    result = ${agentName}(user_input)`;
      } else {
        mainCode += `
${baseIndent}# Execute swarm (sync execution)
${baseIndent}result = ${agentName}(user_input)`;
      }

      mainCode += `
${baseIndent}print(f"Status: {result.status}")
${baseIndent}node_results = [ f"{node.node_id}:{result.results[node.node_id].result}" for node in result.node_history]
${baseIndent}print(f"Node history:\\n{'\\n'.join(node_results)}")
${baseIndent}return '\\n'.join(node_results)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Swarm')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))`;
    } else if (isStreaming) {
      mainCode += `
${baseIndent}# Execute agent with streaming
${baseIndent}async for event in ${agentName}.stream_async(user_input):
${baseIndent}    if "data" in event:
${baseIndent}        print(event['data'],end='',flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Agent')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))`;
    } else {
      mainCode += `
${baseIndent}# Execute agent (sync execution)
${baseIndent}response = ${agentName}(user_input)
${baseIndent}print(str(response))
${baseIndent}
${baseIndent}return str(response)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Agent')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))`;
    }

  // Add closing of the context manager if we have MCP tools
  if (hasMCPTools && executionAgentHasMCPTools) {
    // No need to add anything - the context manager closes automatically with Python's 'with' statement
    // The indentation already handles the proper nesting
  }

  return mainCode;
}

function extractFunctionName(pythonCode: string): string | null {
  if (!pythonCode || !pythonCode.trim()) {
    return null;
  }
  
  // Match function definition: def function_name(
  const match = pythonCode.match(/def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
  return match ? match[1] : null;
}

function sanitizePythonVariableName(name: string): string {
  // Convert to lowercase and replace all non-alphanumeric characters (except underscore) with underscores
  // Then collapse multiple consecutive underscores into single underscores
  return name.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_{2,}/g, '_');
}

function findConnectedSubAgents(
  orchestratorNodes: Node[],
  agentNodes: Node[],
  edges: Edge[]
): Node[] {
  const connectedAgentIds = new Set<string>();
  
  orchestratorNodes.forEach(orchestrator => {
    const subAgentEdges = edges.filter(
      edge => edge.source === orchestrator.id && edge.sourceHandle === 'sub-agents'
    );
    
    subAgentEdges.forEach(edge => {
      const targetAgent = agentNodes.find(agent => agent.id === edge.target);
      if (targetAgent) {
        connectedAgentIds.add(targetAgent.id);
      }
    });
  });
  
  return agentNodes.filter(agent => connectedAgentIds.has(agent.id));
}

/**
 * Finds all sub-orchestrators connected to orchestrator nodes (for hierarchical orchestrators)
 */
function findConnectedSubOrchestrators(
  orchestratorNodes: Node[],
  edges: Edge[]
): Node[] {
  const connectedOrchestratorIds = new Set<string>();
  
  orchestratorNodes.forEach(orchestrator => {
    const subOrchestratorEdges = edges.filter(
      edge => edge.source === orchestrator.id && 
             edge.sourceHandle === 'sub-agents' &&
             edge.targetHandle === 'orchestrator-input'
    );
    
    subOrchestratorEdges.forEach(edge => {
      const targetOrchestrator = orchestratorNodes.find(orch => orch.id === edge.target);
      if (targetOrchestrator) {
        connectedOrchestratorIds.add(targetOrchestrator.id);
      }
    });
  });
  
  return orchestratorNodes.filter(orch => connectedOrchestratorIds.has(orch.id));
}

function isAgentConnectedToOrchestrator(
  agentNode: Node,
  orchestratorNodes: Node[],
  edges: Edge[]
): boolean {
  return edges.some(edge =>
    edge.target === agentNode.id &&
    edge.targetHandle === 'orchestrator-input' &&
    orchestratorNodes.some(orch => orch.id === edge.source)
  );
}

/**
 * Checks if an agent node is connected to any swarm node
 */
function isAgentConnectedToSwarm(
  agentNode: Node,
  swarmNodes: Node[],
  edges: Edge[]
): boolean {
  // Look for edges FROM swarm nodes TO this agent (swarm -> agent connection)
  return edges.some(edge =>
    edge.target === agentNode.id &&
    edge.sourceHandle === 'sub-agents' &&
    swarmNodes.some(swarm => swarm.id === edge.source)
  );
}

function generateAgentAsToolCode(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[],
  index: number
): string {
  const data = agentNode.data || {};
  const {
    label = `Agent${index + 1}`,
    modelProvider = 'AWS Bedrock',
    modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    modelName = 'Claude 3.7 Sonnet',
    systemPrompt = 'You are a helpful AI assistant.',
    temperature = 0.7,
    maxTokens = 4000,
    baseUrl = '',
  } = data;

  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;
  // Sanitize function name to be Python-compatible
  const baseName = sanitizePythonVariableName(label as string);
  const functionName = `${baseName}_${agentNode.id.slice(-4)}`; // Add unique suffix
  
  // Find connected tools (but not orchestrator connections)
  const connectedTools = findConnectedTools(agentNode, allNodes, edges);
  const connectedMCPTools = findConnectedMCPTools(agentNode, allNodes, edges);
  
  // Check if this agent has MCP tools - if so, it needs special handling
  const hasMCPTools = connectedMCPTools.length > 0;
  
  if (hasMCPTools) {
    // Generate MCP-aware agent-as-tool function
    const mcpClientVars = connectedMCPTools.map(mcpNode => {
      const serverName = (mcpNode.data?.serverName as string) || 'mcp_server';
      return `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${mcpNode.id.slice(-4)}`;
    });
    
    const regularToolsList = connectedTools.map(tool => tool.code);
    const toolsArrayCode = regularToolsList.length > 0 
      ? `mcp_tools + [${regularToolsList.join(', ')}]`
      : 'mcp_tools';
    
    return `@tool
def ${functionName}(user_input: str) -> str:
    """${label} - ${(systemPrompt as string).substring(0, 100)}${(systemPrompt as string).length > 100 ? '...' : ''}"""
    
    # Get MCP tools from global context
    global ${mcpClientVars.join(', ')}
    mcp_tools = []
    with ${mcpClientVars.join(', ')}:
        ${mcpClientVars.map(clientVar => `mcp_tools.extend(${clientVar}.list_tools_sync())`).join('\n        ')}
        
        # Create model for ${label}
        ${generateModelConfigForTool(functionName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string)}
        
        # Create agent with MCP tools
        agent = Agent(
            model=${functionName}_model,
            system_prompt="""${systemPrompt}""",
            tools=${toolsArrayCode},
            callback_handler=None
        )
        
        # Execute and return result
        response = agent(user_input)
    return str(response)`;
  } else {
    // Regular agent-as-tool function without MCP tools
    const toolsCode = connectedTools.length > 0 
      ? `,\n        tools=[${connectedTools.map(tool => tool.code).join(', ')}]`
      : '';

    return `@tool
def ${functionName}(user_input: str) -> str:
    """${label} - ${(systemPrompt as string).substring(0, 100)}${(systemPrompt as string).length > 100 ? '...' : ''}"""
    
    # Create model for ${label}
    ${generateModelConfigForTool(functionName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string)}
    
    # Create agent
    agent = Agent(
        model=${functionName}_model,
        system_prompt="""${systemPrompt}"""${toolsCode},
        callback_handler=None
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)`;
  }
}

/**
 * Generates orchestrator-as-tool function for hierarchical orchestrators
 */
function generateOrchestratorAsToolCode(
  orchestratorNode: Node,
  allNodes: Node[],
  edges: Edge[],
  index: number
): string {
  const data = orchestratorNode.data || {};
  const {
    label = `OrchestratorAgent${index + 1}`,
    modelProvider = 'AWS Bedrock',
    modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    modelName = 'Claude 3.7 Sonnet',
    systemPrompt = 'You are an orchestrator agent that coordinates multiple specialized agents.',
    temperature = 0.7,
    maxTokens = 4000,
    coordinationPrompt = '',
    baseUrl = '',
  } = data;

  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;
  // Sanitize function name to be Python-compatible
  const baseName = sanitizePythonVariableName(label as string);
  const functionName = `${baseName}_${orchestratorNode.id.slice(-4)}`; // Add unique suffix
  
  // Find connected sub-agents (both regular agents and sub-orchestrators)
  const subAgentEdges = edges.filter(
    edge => edge.source === orchestratorNode.id && edge.sourceHandle === 'sub-agents'
  );
  const subNodes = subAgentEdges.map(edge => 
    allNodes.find(node => node.id === edge.target)
  ).filter(Boolean);
  
  const subFunctions = subNodes.map(subNode => {
    const labelText = (subNode!.data?.label as string) || 'node';
    const baseName = sanitizePythonVariableName(labelText);
    return `${baseName}_${subNode!.id.slice(-4)}`;
  });
  
  // Find regular tools and MCP tools connected to orchestrator
  const connectedTools = findConnectedTools(orchestratorNode, allNodes, edges);
  const connectedMCPTools = findConnectedMCPTools(orchestratorNode, allNodes, edges);
  
  // Combine regular tools and sub-node functions
  const regularToolsList = connectedTools.map(tool => tool.code);
  const allRegularTools = [...regularToolsList, ...subFunctions];
  
  const hasMCPTools = connectedMCPTools.length > 0;
  const fullSystemPrompt = coordinationPrompt 
    ? `${systemPrompt}\\n\\nCoordination Instructions: ${coordinationPrompt}`
    : systemPrompt;
  
  if (hasMCPTools) {
    // Generate MCP-aware orchestrator-as-tool function
    const mcpClientVars = connectedMCPTools.map(mcpNode => {
      const serverName = (mcpNode.data?.serverName as string) || 'mcp_server';
      return `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${mcpNode.id.slice(-4)}`;
    });
    
    const toolsArrayCode = allRegularTools.length > 0 
      ? `mcp_tools + [${allRegularTools.join(', ')}]`
      : 'mcp_tools';
    
    return `@tool
def ${functionName}(user_input: str) -> str:
    """${label} - ${(systemPrompt as string).substring(0, 100)}${(systemPrompt as string).length > 100 ? '...' : ''}"""
    
    # Get MCP tools from global context
    global ${mcpClientVars.join(', ')}
    mcp_tools = []
    with ${mcpClientVars.join(', ')}:
        ${mcpClientVars.map(clientVar => `mcp_tools.extend(${clientVar}.list_tools_sync())`).join('\n        ')}
        
        # Create model for ${label}
        ${generateModelConfigForTool(functionName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string)}
        
        # Create orchestrator agent with MCP tools
        agent = Agent(
            model=${functionName}_model,
            system_prompt="""${fullSystemPrompt}""",
            tools=${toolsArrayCode},
            callback_handler=None
        )
        
        # Execute and return result
        response = agent(user_input)
    return str(response)`;
  } else {
    // Regular orchestrator-as-tool function without MCP tools
    const toolsCode = allRegularTools.length > 0 
      ? `,\n        tools=[${allRegularTools.join(', ')}]`
      : '';

    return `@tool
def ${functionName}(user_input: str) -> str:
    """${label} - ${(systemPrompt as string).substring(0, 100)}${(systemPrompt as string).length > 100 ? '...' : ''}"""
    
    # Create model for ${label}
    ${generateModelConfigForTool(functionName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string)}
    
    # Create orchestrator agent
    agent = Agent(
        model=${functionName}_model,
        system_prompt="""${fullSystemPrompt}"""${toolsCode},
        callback_handler=None
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)`;
  }
}

function generateOrchestratorModelOnly(
  orchestratorNode: Node,
  _allNodes: Node[],
  _edges: Edge[],
  index: number
): string {
  const data = orchestratorNode.data || {};
  const {
    label = `OrchestratorAgent${index + 1}`,
    modelProvider = 'AWS Bedrock',
    modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    modelName = 'Claude 3.7 Sonnet',
    temperature = 0.7,
    maxTokens = 4000,
    baseUrl = '',
  } = data;

  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;
  // Sanitize orchestrator name to be Python-compatible
  const orchestratorName = sanitizePythonVariableName(label as string);

  // Generate model configuration based on provider
  const modelConfig = generateModelConfigForCode(orchestratorName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string);

  return `# ${label} Configuration
${modelConfig}`;
}

function generateOrchestratorCode(
  orchestratorNode: Node,
  allNodes: Node[],
  edges: Edge[],
  index: number
): string {
  const data = orchestratorNode.data || {};
  const {
    label = `OrchestratorAgent${index + 1}`,
    modelProvider = 'AWS Bedrock',
    modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    modelName = 'Claude 3.7 Sonnet',
    systemPrompt = 'You are an orchestrator agent that coordinates multiple specialized agents.',
    temperature = 0.7,
    maxTokens = 4000,
    coordinationPrompt = '',
    baseUrl = '',
  } = data;

  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;
  // Sanitize orchestrator name to be Python-compatible
  const orchestratorName = sanitizePythonVariableName(label as string);
  
  // Find connected sub-agents (both regular agents and sub-orchestrators)
  const subAgentEdges = edges.filter(
    edge => edge.source === orchestratorNode.id && edge.sourceHandle === 'sub-agents'
  );
  const subNodes = subAgentEdges.map(edge => 
    allNodes.find(node => node.id === edge.target)
  ).filter(Boolean);
  
  const subFunctions = subNodes.map(subNode => {
    // Sanitize node name to be Python-compatible (works for both agents and orchestrators)
    const labelText = (subNode!.data?.label as string) || 'node';
    const baseName = sanitizePythonVariableName(labelText);
    return `${baseName}_${subNode!.id.slice(-4)}`;
  });
  
  // Find regular tools and MCP tools connected to orchestrator
  const connectedTools = findConnectedTools(orchestratorNode, allNodes, edges);
  const connectedMCPTools = findConnectedMCPTools(orchestratorNode, allNodes, edges);
  
  // Combine regular tools and sub-node functions (both agents and orchestrators)
  const regularToolsList = connectedTools.map(tool => tool.code);
  const allRegularTools = [...regularToolsList, ...subFunctions];
  
  // Generate tools code - handle MCP tools if present
  // Check if orchestrator itself has MCP tools OR any of its sub-nodes have MCP tools
  const subNodeHasMCPTools = subNodes.some(subNode => {
    const subNodeMCPTools = findConnectedMCPTools(subNode!, allNodes, edges);
    return subNodeMCPTools.length > 0;
  });
  const hasMCPTools = connectedMCPTools.length > 0 || subNodeHasMCPTools;
  let toolsCode = '';
  
  if (hasMCPTools) {
    const toolsArrayCode = allRegularTools.length > 0 
      ? `mcp_tools + [${allRegularTools.join(', ')}]`
      : 'mcp_tools';
    toolsCode = `,\n    tools=${toolsArrayCode}`;
  } else {
    toolsCode = allRegularTools.length > 0 
      ? `,\n    tools=[${allRegularTools.join(', ')}]`
      : '';
  }

  const fullSystemPrompt = coordinationPrompt 
    ? `${systemPrompt}\n\nCoordination Instructions: ${coordinationPrompt}`
    : systemPrompt;

  if (hasMCPTools) {
    // When MCP tools are present, only define the model - agent creation happens in main()
    const modelConfig = generateModelConfigForCode(orchestratorName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string);
    return `# ${label} Configuration
${modelConfig}

# ${orchestratorName} will be created in main() with MCP tools`;
  } else {
    // Regular orchestrator without MCP tools
    const modelConfig = generateModelConfigForCode(orchestratorName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string);
    return `# ${label} Configuration
${modelConfig}

${orchestratorName} = Agent(
    model=${orchestratorName}_model,
    system_prompt="""${fullSystemPrompt}"""${toolsCode},
    callback_handler=None
)`;
  }
}

function generateModelConfigForCode(
  varName: string,
  modelProvider: string,
  modelIdentifier: string,
  temperature: number,
  maxTokens: number,
  baseUrl: string
): string {
  if (modelProvider === 'OpenAI') {
    const clientArgs = [];
    // Always use environment variable for API key for security - never hardcode
    clientArgs.push(`"api_key": os.environ.get("OPENAI_API_KEY")`);
    if (baseUrl) {
      clientArgs.push(`"base_url": "${baseUrl}"`);
    }
    
    const clientArgsStr = `\n    client_args={\n        ${clientArgs.join(',\n        ')}\n    },`;
    
    return `${varName}_model = OpenAIModel(${clientArgsStr}
    model_id="${modelIdentifier}",
    params={
        "max_tokens": ${maxTokens},
        "temperature": ${temperature},
    }
)`;
  } else {
    // Default to Bedrock
    return `${varName}_model = BedrockModel(
    model_id="${modelIdentifier}",
    temperature=${temperature},
    max_tokens=${maxTokens}
)`;
  }
}

function generateModelConfigForTool(
  varName: string,
  modelProvider: string,
  modelIdentifier: string,
  temperature: number,
  maxTokens: number,
  baseUrl: string
): string {
  if (modelProvider === 'OpenAI') {
    const clientArgs = [];
    // Always use environment variable for API key for security - never hardcode
    clientArgs.push(`\"api_key\": os.environ.get(\"OPENAI_API_KEY\")`);
    if (baseUrl) {
      clientArgs.push(`\"base_url\": \"${baseUrl}\"`);
    }
    
    const clientArgsStr = `\n            client_args={\n                ${clientArgs.join(',\n                ')}\n            },`;
    
    return `${varName}_model = OpenAIModel(${clientArgsStr}
            model_id="${modelIdentifier}",
            params={
                "max_tokens": ${maxTokens},
                "temperature": ${temperature},
            }
        )`;
  } else {
    // Default to Bedrock
    return `${varName}_model = BedrockModel(
            model_id="${modelIdentifier}",
            temperature=${temperature},
            max_tokens=${maxTokens}
        )`;
  }
}

export function generateCustomToolCode(
  toolNode: Node
): string {
  const data = toolNode.data || {};
  const { pythonCode = '' } = data;
  const codeString = pythonCode as string;

  const hasCustomCode = codeString && codeString.trim();

  if (hasCustomCode) {
    // User provided complete function - just wrap it with @tool decorator
    return `@tool\n${codeString.trim()}`;
  } else {
    // Generate template function
    return `@tool
def custom_tool(input_text: str) -> str:
    """Custom tool function - replace with your implementation"""
    # TODO: Implement your custom tool logic here
    result = f"Processed: {input_text}"
    return result`;
  }
}

/**
 * Finds all agent nodes connected to a swarm node
 */
function findConnectedSwarmAgents(
  swarmNode: Node,
  agentNodes: Node[],
  edges: Edge[]
): Node[] {
  const connectedAgentIds = new Set<string>();

  const swarmAgentEdges = edges.filter(
    edge => edge.source === swarmNode.id && edge.sourceHandle === 'sub-agents'
  );

  swarmAgentEdges.forEach(edge => {
    const targetAgent = agentNodes.find(agent => agent.id === edge.target);
    if (targetAgent) {
      connectedAgentIds.add(targetAgent.id);
    }
  });

  return agentNodes.filter(agent => connectedAgentIds.has(agent.id));
}

/**
 * Generates swarm instantiation code
 */
function generateSwarmCode(
  swarmNode: Node,
  agentNodes: Node[],
  _allNodes: Node[],
  edges: Edge[],
  index: number
): string {
  const data = swarmNode.data || {};
  const {
    label = `Swarm${index + 1}`,
    maxHandoffs = 20,
    maxIterations = 20,
    executionTimeout = 900,
    nodeTimeout = 300,
    repetitiveHandoffDetectionWindow = 0,
    repetitiveHandoffMinUniqueAgents = 0,
    entryPointAgentId = null,
  } = data;

  // Find connected agents
  const connectedAgents = findConnectedSwarmAgents(swarmNode, agentNodes, edges);

  if (connectedAgents.length === 0) {
    return `# ERROR: ${label} has no connected agents`;
  }

  // Sanitize swarm name to be Python-compatible
  const swarmVarName = sanitizePythonVariableName(label as string);

  // Get agent variable names
  const agentVarNames = connectedAgents.map(agent => {
    const agentLabel = (agent.data?.label as string) || 'agent';
    return sanitizePythonVariableName(agentLabel);
  });

  // Determine entry point
  let entryPointCode = '';
  if (entryPointAgentId) {
    const entryPointAgent = connectedAgents.find(agent => agent.id === entryPointAgentId);
    if (entryPointAgent) {
      const entryPointVarName = sanitizePythonVariableName((entryPointAgent.data?.label as string) || 'agent');
      entryPointCode = `,\n    entry_point=${entryPointVarName}`;
    }
  }

  return `# ${label} Configuration
${swarmVarName} = Swarm(
    [${agentVarNames.join(', ')}]${entryPointCode},
    max_handoffs=${maxHandoffs},
    max_iterations=${maxIterations},
    execution_timeout=${executionTimeout}.0,
    node_timeout=${nodeTimeout}.0,
    repetitive_handoff_detection_window=${repetitiveHandoffDetectionWindow},
    repetitive_handoff_min_unique_agents=${repetitiveHandoffMinUniqueAgents}
)`;
}