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
  ]);
  
  // Check if MCP tools are used
  const hasMCPTools = nodes.some(node => node.type === 'mcp-tool');
  if (hasMCPTools) {
    imports.add('from strands.tools.mcp import MCPClient');
    imports.add('from mcp import stdio_client, StdioServerParameters');
    imports.add('from mcp.client.streamable_http import streamablehttp_client');
    imports.add('from mcp.client.sse import sse_client');
  }
  
  const errors: string[] = [];
  let code = '';

  try {
    // Find all node types
    const agentNodes = nodes.filter(node => node.type === 'agent');
    const orchestratorNodes = nodes.filter(node => node.type === 'orchestrator-agent');
    const inputNodes = nodes.filter(node => node.type === 'input');
    const outputNodes = nodes.filter(node => node.type === 'output');
    
    // Check if any agents use OpenAI and add the import
    const allAgentNodes = [...agentNodes, ...orchestratorNodes];
    const hasOpenAIProvider = allAgentNodes.some(node => node.data?.modelProvider === 'OpenAI');
    if (hasOpenAIProvider) {
      imports.add('from strands.models.openai import OpenAIModel');
    }
    
    // Validate mandatory nodes
    if (agentNodes.length === 0 && orchestratorNodes.length === 0) {
      errors.push('No agent nodes found. At least one agent or orchestrator agent is required.');
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
        errors.push('Input nodes must be connected to agents. Please connect your input node to an agent.');
      }
    }
    
    if (outputNodes.length > 0) {
      const connectedOutputs = outputNodes.filter(outputNode => 
        edges.some(edge => edge.target === outputNode.id)
      );
      if (connectedOutputs.length === 0) {
        errors.push('Output nodes must be connected to agents. Please connect an agent to your output node.');
      }
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
    }

    // Generate code for each regular agent (non-connected ones)
    // Skip individual agent generation only if we have MCP tools AND no orchestrators
    // If we have orchestrators, we always need individual agents for the agent-as-tool pattern
    if (!hasMCPTools || orchestratorNodes.length > 0) {
      const unconnectedAgents = orchestratorNodes.length > 0 
        ? agentNodes.filter(agent => !isAgentConnectedToOrchestrator(agent, orchestratorNodes, edges))
        : agentNodes;
        
      unconnectedAgents.forEach((agentNode, index) => {
        const agentCode = generateAgentCode(agentNode, nodes, edges, index);
        code += agentCode + '\n\n';
      });
    }

    // Generate orchestrator agent code
    orchestratorNodes.forEach((orchestratorNode, index) => {
      const orchestratorCode = generateOrchestratorCode(orchestratorNode, nodes, edges, index);
      code += orchestratorCode + '\n\n';
    });

    // Generate main execution code
    const allExecutableAgents = [...agentNodes, ...orchestratorNodes];
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
    system_prompt="""${systemPromptValue}"""${toolsCode}
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
      env = {}
    } = data;

    const clientVarName = `${(serverName as string).toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${mcpNode.id.slice(-4)}`;

    mcpCode += `\n# ${serverName} MCP Client\n`;
    
    switch (transportType) {
      case 'stdio': {
        const argsStr = (args as string[]).length > 0 ? JSON.stringify(args) : '[]';
        const envStr = Object.keys(env as object).length > 0 ? `,\n        env=${JSON.stringify(env)}` : '';
        mcpCode += `${clientVarName} = MCPClient(lambda: stdio_client(
    StdioServerParameters(
        command="${command}",
        args=${argsStr}${envStr}
    )
))\n`;
        break;
      }
        
      case 'streamable_http':
        mcpCode += `${clientVarName} = MCPClient(
    lambda: streamablehttp_client("${url}")
)\n`;
        break;
        
      case 'sse':
        mcpCode += `${clientVarName} = MCPClient(
    lambda: sse_client("${url}")
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


function findConnectedUserInputs(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[]
): Array<{ node: Node; content: string }> {
  const connectedInputEdges = edges.filter(
    edge => edge.target === agentNode.id && edge.targetHandle === 'user-input'
  );
  
  return connectedInputEdges.map(edge => {
    const inputNode = allNodes.find(node => node.id === edge.source);
    if (!inputNode) return { node: {} as Node, content: '' };
    
    const inputData = inputNode.data || {};
    const inputType = (inputData.inputType as string) || 'user-prompt';
    
    // Include all input types (user-prompt, data, variable)
    if (inputType === 'user-prompt' || inputType === 'data' || inputType === 'variable') {
      return {
        node: inputNode,
        content: (inputData.content as string) || '',
      };
    }
    
    return { node: inputNode, content: '' };
  }).filter(input => input.content !== '');
}

function findConnectedAgent(
  allNodes: Node[],
  edges: Edge[]
): Node | null {
  // Find input nodes
  const inputNodes = allNodes.filter(node => node.type === 'input');
  
  // Find agents connected to input nodes
  for (const inputNode of inputNodes) {
    const connectedEdges = edges.filter(edge => edge.source === inputNode.id);
    for (const edge of connectedEdges) {
      const targetNode = allNodes.find(node => node.id === edge.target);
      if (targetNode && (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent')) {
        return targetNode;
      }
    }
  }
  
  // Fallback: return first agent if no connections found
  const allAgents = allNodes.filter(node => node.type === 'agent' || node.type === 'orchestrator-agent');
  return allAgents.length > 0 ? allAgents[0] : null;
}

function generateMainExecutionCode(
  _agentNodes: Node[],
  allNodes: Node[],
  edges: Edge[],
  hasMCPTools: boolean = false
): string {
  const mcpNodes = allNodes.filter(node => node.type === 'mcp-tool');
  
  let mainCode = `# Main execution
async def main():`;

  // Find the agent that should be executed (connected to input)
  const executionAgent = findConnectedAgent(allNodes, edges);
  if (!executionAgent) {
    return mainCode + `
    print("No agent found to execute")
    return ""

if __name__ == "__main__":
    asyncio.run(main())`;
  }

  if (hasMCPTools) {
    // All MCP clients need to be in global scope and context managers
    const allMcpClientVars = mcpNodes.map(node => {
      const serverName = (node.data?.serverName as string) || 'mcp_server';
      return `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${node.id.slice(-4)}`;
    });
    
    // But only MCP tools directly connected to execution agent are added to it
    const executionAgentMCPTools = findConnectedMCPTools(executionAgent, allNodes, edges);
    const executionAgentMcpClientVars = executionAgentMCPTools.map(node => {
      const serverName = (node.data?.serverName as string) || 'mcp_server';
      return `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${node.id.slice(-4)}`;
    });
    
    // Include custom tool function names in globals for MCP mode
    const customToolNodes = allNodes.filter(node => node.type === 'custom-tool');
    const customToolGlobals = customToolNodes.map(node => {
      const pythonCode = (node.data?.pythonCode as string) || '';
      return extractFunctionName(pythonCode) || 'custom_tool';
    });
    const allGlobals = ['user_input', 'input_data', ...allMcpClientVars, ...customToolGlobals];
    
    mainCode += `
    global ${allGlobals.join(', ')}
    
    # Use MCP clients in context managers
    with ${allMcpClientVars.join(', ')}:
        # Get tools from MCP servers
        mcp_tools = []`;
    
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
    
    // Check if this is an orchestrator agent
    const isOrchestrator = executionAgent.type === 'orchestrator-agent';
    
    if (isOrchestrator) {
      // For orchestrator agents, create with sub-agents and tools
      const subAgentEdges = edges.filter(
        edge => edge.source === executionAgent.id && edge.sourceHandle === 'sub-agents'
      );
      const subAgentNodes = subAgentEdges.map(edge => 
        allNodes.find(node => node.id === edge.target)
      ).filter(Boolean);
      
      const subAgentFunctions = subAgentNodes.map(agent => {
        const labelText = (agent!.data?.label as string) || 'agent';
        const baseName = sanitizePythonVariableName(labelText);
        return `${baseName}_${agent!.id.slice(-4)}`;
      });
      
      // Find connected non-MCP tools and MCP tools
      const connectedTools = findConnectedTools(executionAgent, allNodes, edges);
      const connectedMCPTools = findConnectedMCPTools(executionAgent, allNodes, edges);
      const regularToolsList = connectedTools.map(tool => tool.code);
      const allRegularTools = [...regularToolsList, ...subAgentFunctions];
      
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
      
      mainCode += `
        
        # Create orchestrator agent with MCP tools
        ${agentName} = Agent(
            model=${agentName}_model,
            system_prompt="""${fullSystemPrompt}""",
            tools=${toolsArrayCode}
        )`;
    } else {
      // Regular agent
      const connectedTools = findConnectedTools(executionAgent, allNodes, edges);
      const nonMCPTools = connectedTools.filter(tool => tool.node.type !== 'mcp-tool');
      const regularToolsList = nonMCPTools.map(tool => tool.code);
      const toolsArrayCode = regularToolsList.length > 0 
        ? `mcp_tools + [${regularToolsList.join(', ')}]`
        : 'mcp_tools';
      
      mainCode += `
        
        # Create agent with MCP tools
        ${agentName} = Agent(
            model=${agentName}_model,
            system_prompt="""${systemPrompt}""",
            tools=${toolsArrayCode}
        )`;
    }
  } else {
    // Sanitize agent names for global variables using connected agent
    const executionAgentName = sanitizePythonVariableName((executionAgent.data?.label as string) || 'agent1');
    
    mainCode += `
    # Access the global variables
    global user_input, input_data, ${executionAgentName}`;
  }

  const baseIndent = hasMCPTools ? '        ' : '    ';
  
  // Generate execution for the connected agent
  const label = (executionAgent.data?.label as string) || 'agent1';
  const agentName = sanitizePythonVariableName(label);
  
  // Check if this agent has connected user inputs
  const connectedUserInputs = findConnectedUserInputs(executionAgent, allNodes, edges);
    
    // Generate user input logic that prioritizes input_data from execution panel
    mainCode += `${baseIndent.slice(4)}
${baseIndent}# User input - prioritize input_data from execution panel
${baseIndent}if input_data is not None and input_data.strip():
${baseIndent}    user_input = input_data.strip()
`;
    
    if (connectedUserInputs.length > 0) {
      mainCode += `${baseIndent}else:
${baseIndent}    # Fallback to connected input node
${baseIndent}    user_input = "${connectedUserInputs[0].content || 'Hello, how can you help me?'}"
${baseIndent}
`;
    } else {
      // Fall back to finding any unconnected user-prompt input nodes (legacy behavior)
      const inputNodes = allNodes.filter(node => node.type === 'input');
      const unconnectedInputs = inputNodes.filter(inputNode => {
        const isConnected = edges.some(edge => 
          edge.source === inputNode.id && edge.targetHandle === 'user-input'
        );
        const inputType = inputNode.data?.inputType || 'user-prompt';
        // Consider all input types for user input
        return !isConnected && (inputType === 'user-prompt' || inputType === 'data' || inputType === 'variable');
      });
      
      if (unconnectedInputs.length > 0) {
        mainCode += `${baseIndent}else:
${baseIndent}    # Fallback to unconnected input node
${baseIndent}    user_input = "${unconnectedInputs[0].data?.content || 'Hello, how can you help me?'}"
${baseIndent}
`;
      } else {
        mainCode += `${baseIndent}else:
${baseIndent}    # Default fallback
${baseIndent}    user_input = "Hello, how can you help me?"
${baseIndent}
`;
      }
    }
    
    const executionAgentData = executionAgent.data || {};
    const isStreaming = executionAgentData.streaming || false;
    
    if (isStreaming) {
      mainCode += `${baseIndent}# Execute agent with streaming
${baseIndent}print("Starting streaming response...")
${baseIndent}async for event in ${agentName}.stream_async(user_input):
${baseIndent}    if "data" in event:
${baseIndent}        print(event['data'],end='',flush=True)
${baseIndent}        yield event["data"]

if __name__ == "__main__":
    asyncio.run(main())`;
    } else {
      mainCode += `${baseIndent}# Execute agent (sync execution)
${baseIndent}response = ${agentName}(user_input)
${baseIndent}print("Agent Response:", str(response))
${baseIndent}
${baseIndent}return str(response)

if __name__ == "__main__":
    asyncio.run(main())`;
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
            tools=${toolsArrayCode}
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
        system_prompt="""${systemPrompt}"""${toolsCode}
    )
    
    # Execute and return result
    response = agent(user_input)
    return str(response)`;
  }
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
  
  // Find connected sub-agents
  const subAgentEdges = edges.filter(
    edge => edge.source === orchestratorNode.id && edge.sourceHandle === 'sub-agents'
  );
  const subAgentNodes = subAgentEdges.map(edge => 
    allNodes.find(node => node.id === edge.target)
  ).filter(Boolean);
  
  const subAgentFunctions = subAgentNodes.map(agent => {
    // Sanitize agent name to be Python-compatible
    const labelText = (agent!.data?.label as string) || 'agent';
    const baseName = sanitizePythonVariableName(labelText);
    return `${baseName}_${agent!.id.slice(-4)}`;
  });
  
  // Find regular tools and MCP tools connected to orchestrator
  const connectedTools = findConnectedTools(orchestratorNode, allNodes, edges);
  const connectedMCPTools = findConnectedMCPTools(orchestratorNode, allNodes, edges);
  
  // Combine regular tools and sub-agent functions
  const regularToolsList = connectedTools.map(tool => tool.code);
  const allRegularTools = [...regularToolsList, ...subAgentFunctions];
  
  // Generate tools code - handle MCP tools if present
  // Check if orchestrator itself has MCP tools OR any of its sub-agents have MCP tools
  const subAgentHasMCPTools = subAgentNodes.some(subAgent => {
    const subAgentMCPTools = findConnectedMCPTools(subAgent!, allNodes, edges);
    return subAgentMCPTools.length > 0;
  });
  const hasMCPTools = connectedMCPTools.length > 0 || subAgentHasMCPTools;
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
    system_prompt="""${fullSystemPrompt}"""${toolsCode}
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
            model_id=\"${modelIdentifier}\",
            params={
                \"max_tokens\": ${maxTokens},
                \"temperature\": ${temperature},
            }
        )`;
  } else {
    // Default to Bedrock
    return `${varName}_model = BedrockModel(
            model_id=\"${modelIdentifier}\",
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