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
    // Find all agent nodes
    const agentNodes = nodes.filter(node => node.type === 'agent');
    
    if (agentNodes.length === 0) {
      errors.push('No agent nodes found. At least one agent is required.');
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
      const mcpCode = generateMCPSetupCode(nodes, edges);
      code += mcpCode + '\n\n';
    }

    // Generate code for each agent
    if (!hasMCPTools) {
      // For non-MCP agents, generate them globally
      agentNodes.forEach((agentNode, index) => {
        const agentCode = generateAgentCode(agentNode, nodes, edges, index);
        code += agentCode + '\n\n';
      });
    }

    // Generate main execution code
    code += generateMainExecutionCode(agentNodes, nodes, edges, hasMCPTools);

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
    streaming = false,
  } = data;

  // Use modelId for Bedrock, modelName for others
  const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;

  // Find connected tools
  const connectedTools = findConnectedTools(agentNode, allNodes, edges);
  const toolsCode = connectedTools.length > 0 
    ? `,\n    tools=[${connectedTools.map(tool => tool.code).join(', ')}]`
    : '';

  // System prompt comes from agent property panel only (no input connections)
  const systemPromptValue = systemPrompt;

  return `# ${label} Configuration
${label.toLowerCase().replace(/\s+/g, '_')}_model = BedrockModel(
    model_id="${modelIdentifier}",
    temperature=${temperature},
    max_tokens=${maxTokens}
)

${label.toLowerCase().replace(/\s+/g, '_')} = Agent(
    model=${label.toLowerCase().replace(/\s+/g, '_')}_model,
    system_prompt="""${systemPromptValue}"""${toolsCode}
)`;
}

function generateMCPSetupCode(nodes: Node[], edges: Edge[]): string {
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
      timeout = 30,
      env = {}
    } = data;

    const clientVarName = `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client`;

    mcpCode += `\n# ${serverName} MCP Client\n`;
    
    switch (transportType) {
      case 'stdio':
        const argsStr = args.length > 0 ? JSON.stringify(args) : '[]';
        const envStr = Object.keys(env).length > 0 ? `,\n        env=${JSON.stringify(env)}` : '';
        mcpCode += `${clientVarName} = MCPClient(lambda: stdio_client(
    StdioServerParameters(
        command="${command}",
        args=${argsStr}${envStr}
    )
))\n`;
        break;
        
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
    if (!toolNode) return { node: toolNode as Node, code: '' };
    
    const toolData = toolNode.data || {};
    
    if (toolNode.type === 'tool') {
      const toolName = toolData.toolName || 'calculator';
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
      const pythonCode = toolData.pythonCode || '';
      const functionName = extractFunctionName(pythonCode) || 'custom_tool';
      return {
        node: toolNode,
        code: `${functionName}`,  // Use extracted function name
      };
    } else if (toolNode.type === 'mcp-tool') {
      // MCP tools are handled separately in the main execution
      return {
        node: toolNode,
        code: '',  // Don't include MCP tools in regular tools list
      };
    }
    
    return { node: toolNode, code: '' };
  }).filter(tool => tool.code !== '');
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
    if (!inputNode) return { node: inputNode as Node, content: '' };
    
    const inputData = inputNode.data || {};
    const inputType = inputData.inputType || 'user-prompt';
    
    // Include all input types (user-prompt, data, variable)
    if (inputType === 'user-prompt' || inputType === 'data' || inputType === 'variable') {
      return {
        node: inputNode,
        content: inputData.content || '',
      };
    }
    
    return { node: inputNode as Node, content: '' };
  }).filter(input => input.content !== '');
}

function generateMainExecutionCode(
  agentNodes: Node[],
  allNodes: Node[],
  edges: Edge[],
  hasMCPTools: boolean = false
): string {
  const mcpNodes = allNodes.filter(node => node.type === 'mcp-tool');
  
  let mainCode = `# Main execution
def main():`;

  if (hasMCPTools) {
    const mcpClientVars = mcpNodes.map(node => {
      const serverName = node.data?.serverName || 'mcp_server';
      return `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client`;
    });
    
    // Include custom tool function names in globals for MCP mode
    const customToolNodes = allNodes.filter(node => node.type === 'custom-tool');
    const customToolGlobals = customToolNodes.map(node => {
      const pythonCode = node.data?.pythonCode || '';
      return extractFunctionName(pythonCode) || 'custom_tool';
    });
    const allGlobals = ['user_input', 'input_data', ...mcpClientVars, ...customToolGlobals];
    
    mainCode += `
    global ${allGlobals.join(', ')}
    
    # Use MCP clients in context managers
    with ${mcpClientVars.join(', ')}:
        # Get tools from MCP servers
        mcp_tools = []`;
    
    // Add tool collection from each MCP client
    mcpClientVars.forEach(clientVar => {
      mainCode += `
        mcp_tools.extend(${clientVar}.list_tools_sync())`;
    });
    
    // Generate agent creation inside context manager
    if (agentNodes.length > 0) {
      const firstAgent = agentNodes[0];
      const agentData = firstAgent.data || {};
      const {
        label = 'Agent1',
        modelProvider = 'AWS Bedrock',
        modelId = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
        modelName = 'Claude 3.7 Sonnet',
        systemPrompt = 'You are a helpful AI assistant.',
        temperature = 0.7,
        maxTokens = 4000,
      } = agentData;
      
      const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;
      const agentName = label.toLowerCase().replace(/\s+/g, '_');
      
      // Find connected non-MCP tools
      const connectedTools = findConnectedTools(firstAgent, allNodes, edges);
      const nonMCPTools = connectedTools.filter(tool => tool.node.type !== 'mcp-tool');
      const regularToolsList = nonMCPTools.map(tool => tool.code);
      const toolsArrayCode = regularToolsList.length > 0 
        ? `mcp_tools + [${regularToolsList.join(', ')}]`
        : 'mcp_tools';
      
      mainCode += `
        
        # Create model
        ${agentName}_model = BedrockModel(
            model_id="${modelIdentifier}",
            temperature=${temperature},
            max_tokens=${maxTokens}
        )
        
        # Create agent with MCP tools
        ${agentName} = Agent(
            model=${agentName}_model,
            system_prompt="""${systemPrompt}""",
            tools=${toolsArrayCode}
        )`;
    }
  } else {
    mainCode += `
    # Access the global variables
    global user_input, input_data, ${agentNodes.map(node => node.data?.label?.toLowerCase().replace(/\s+/g, '_') || 'agent1').join(', ')}`;
  }

  const baseIndent = hasMCPTools ? '        ' : '    ';
  
  // Generate execution for the first agent (simplified)
  if (agentNodes.length > 0) {
    const firstAgent = agentNodes[0];
    const agentName = firstAgent.data?.label?.toLowerCase().replace(/\s+/g, '_') || 'agent1';
    
    // Check if this agent has connected user inputs
    const connectedUserInputs = findConnectedUserInputs(firstAgent, allNodes, edges);
    
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
    
    const firstAgentData = firstAgent.data || {};
    const isStreaming = firstAgentData.streaming || false;
    
    if (isStreaming) {
      mainCode += `${baseIndent}# Execute agent with streaming
${baseIndent}print("Starting streaming response...")
${baseIndent}async def stream_response():
${baseIndent}    async for event in ${agentName}.stream_async(user_input):
${baseIndent}        if "data" in event:
${baseIndent}            print(event["data"], end="", flush=True)
${baseIndent}    print()  # New line after streaming
${baseIndent}
${baseIndent}# For sync execution, we'll use regular call
${baseIndent}# In a real async environment, you'd use: await stream_response()
${baseIndent}response = ${agentName}(user_input)
${baseIndent}print("\\nFinal Response:", str(response))
${baseIndent}
${baseIndent}return str(response)

if __name__ == "__main__":
    main()`;
    } else {
      mainCode += `${baseIndent}# Execute agent
${baseIndent}response = ${agentName}(user_input)
${baseIndent}print("Agent Response:", str(response))
${baseIndent}
${baseIndent}return str(response)

if __name__ == "__main__":
    main()`;
    }
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

export function generateCustomToolCode(
  toolNode: Node
): string {
  const data = toolNode.data || {};
  const { pythonCode = '' } = data;

  const hasCustomCode = pythonCode && pythonCode.trim();
  
  if (hasCustomCode) {
    // User provided complete function - just wrap it with @tool decorator
    return `@tool\n${pythonCode.trim()}`;
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