import { type Node, type Edge } from '@xyflow/react';
import { validateGraphStructure } from './graph-validator';

interface CodeGenerationResult {
  code: string;
  imports: string[];
  errors: string[];
}

// Safely escape strings for Python triple-quoted string literals
function escapePythonTripleQuotedString(str: string): string {
  if (!str) return str;
  return str
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/"""/g, '\\"\\"\\"'); // Then escape triple quotes
}

// Sanitize Python variable names
function sanitizePythonVariableName(name: string): string {
  return name.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_{2,}/g, '_');
}

/**
 * Extract function name from Python code for custom tools
 */
function extractFunctionName(pythonCode: string): string | null {
  if (!pythonCode || !pythonCode.trim()) {
    return null;
  }
  const match = pythonCode.match(/def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
  return match ? match[1] : null;
}

/**
 * Generate model configuration code for an agent
 */
function generateModelConfig(
  varName: string,
  modelProvider: string,
  modelIdentifier: string,
  temperature: number,
  maxTokens: number,
  baseUrl: string,
  thinkingEnabled?: boolean,
  thinkingBudgetTokens?: number,
  reasoningEffort?: string
): string {
  // When thinking is enabled for Bedrock, temperature must be 1
  const isBedrock = modelProvider === 'AWS Bedrock' || modelProvider === undefined;
  const finalTemperature = thinkingEnabled && isBedrock ? 1 : temperature;

  if (modelProvider === 'OpenAI') {
    const clientArgs = [];
    clientArgs.push(`"api_key": os.environ.get("OPENAI_API_KEY")`);
    if (baseUrl) {
      clientArgs.push(`"base_url": "${baseUrl}"`);
    }
    const clientArgsStr = `\n    client_args={\n        ${clientArgs.join(',\n        ')}\n    },`;

    const params = [`"max_tokens": ${maxTokens}`, `"temperature": ${finalTemperature}`];
    if (thinkingEnabled && reasoningEffort) {
      params.push(`"reasoning_effort": "${reasoningEffort}"`);
    }

    return `${varName}_model = OpenAIModel(${clientArgsStr}
    model_id="${modelIdentifier}",
    params={
        ${params.join(',\n        ')},
    }
)`;
  } else {
    // Default to Bedrock
    let bedrockCode = `${varName}_model = BedrockModel(
    model_id="${modelIdentifier}",
    temperature=${finalTemperature},
    max_tokens=${maxTokens}`;

    if (thinkingEnabled && thinkingBudgetTokens) {
      bedrockCode += `,
    additional_request_fields={
        "thinking": {
            "type": "enabled",
            "budget_tokens": ${thinkingBudgetTokens}
        }
    }`;
    }

    bedrockCode += '\n)';
    return bedrockCode;
  }
}

/**
 * Find all tools connected to an agent node (excluding MCP tools)
 */
function findConnectedTools(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[]
): Array<{ node: Node; code: string }> {
  const connectedToolEdges = edges.filter(
    edge => edge.target === agentNode.id && edge.targetHandle === 'tools'
  );

  return connectedToolEdges.map(edge => {
    const toolNode = allNodes.find(node => node.id === edge.source);
    if (!toolNode) return { node: {} as Node, code: '' };

    const toolData = toolNode.data || {};

    if (toolNode.type === 'tool') {
      const toolName = (toolData.toolName as string) || 'calculator';
      const toolMapping: Record<string, string> = {
        'calculator': 'calculator',
        'file_read': 'file_read',
        'file_reader': 'file_read',
        'shell': 'shell',
        'current_time': 'current_time',
      };
      const mappedTool = toolMapping[toolName] || 'calculator';
      return { node: toolNode, code: mappedTool };
    } else if (toolNode.type === 'custom-tool') {
      const pythonCode = (toolData.pythonCode as string) || '';
      const functionName = extractFunctionName(pythonCode) || 'custom_tool';
      return { node: toolNode, code: functionName };
    }

    return { node: toolNode, code: '' };
  }).filter(tool => tool.code !== '');
}

/**
 * Find MCP tools connected to an agent node
 */
function findConnectedMCPTools(
  agentNode: Node,
  allNodes: Node[],
  edges: Edge[]
): Array<{ node: Node; clientVarName: string; toolsVarName: string }> {
  const connectedMCPEdges = edges.filter(
    edge => edge.target === agentNode.id && edge.targetHandle === 'tools'
  );

  return connectedMCPEdges
    .map(edge => {
      const toolNode = allNodes.find(node => node.id === edge.source);
      if (!toolNode || toolNode.type !== 'mcp-tool') return null;

      const serverName = (toolNode.data?.serverName as string) || 'mcp_server';
      const clientVarName = `${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${toolNode.id.slice(-4)}`;
      const toolsVarName = `tools_${toolNode.id.slice(-4)}`;

      return { node: toolNode, clientVarName, toolsVarName };
    })
    .filter((item): item is { node: Node; clientVarName: string; toolsVarName: string } => item !== null);
}

/**
 * Generate code for custom tools
 */
function generateCustomToolCode(toolNode: Node): string {
  const data = toolNode.data || {};
  const { pythonCode = '' } = data;
  const codeString = pythonCode as string;

  const hasCustomCode = codeString && codeString.trim();

  if (hasCustomCode) {
    return `@tool\n${codeString.trim()}`;
  } else {
    return `@tool
def custom_tool(input_text: str) -> str:
    """Custom tool function - replace with your implementation"""
    result = f"Processed: {input_text}"
    return result`;
  }
}

/**
 * Generate MCP client setup code
 */
function generateMCPSetupCode(mcpNodes: Node[]): string {
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

/**
 * Generate GraphBuilder-based code for graph orchestration mode
 */
export function generateGraphCode(
  nodes: Node[],
  edges: Edge[]
): CodeGenerationResult {
  const imports = new Set<string>([
    'from strands import Agent, tool',
    'from strands.models import BedrockModel',
    'from strands.multiagent import GraphBuilder',
    'from strands_tools import calculator, file_read, shell, current_time',
    'import json',
    'import os',
    'import asyncio',
    'import argparse'
  ]);

  const errors: string[] = [];
  let code = '';

  try {
    // Validate graph structure
    const validation = validateGraphStructure(nodes, edges);

    if (!validation.valid) {
      errors.push(...validation.errors);
      return { code: '', imports: Array.from(imports), errors };
    }

    // Add warnings to errors array (non-blocking)
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        console.warn(`Graph warning: ${warning}`);
      });
    }

    // Find all agent nodes
    const agentNodes = nodes.filter(node =>
      (node.type === 'agent' || node.type === 'orchestrator-agent' || node.type === 'swarm')
    );

    const customToolNodes = nodes.filter(node => node.type === 'custom-tool');
    const mcpNodes = nodes.filter(node => node.type === 'mcp-tool');

    // Check if OpenAI provider is used
    const hasOpenAIProvider = agentNodes.some(node => node.data?.modelProvider === 'OpenAI');
    if (hasOpenAIProvider) {
      imports.add('from strands.models.openai import OpenAIModel');
    }

    // Check if MCP tools are used
    if (mcpNodes.length > 0) {
      imports.add('from strands.tools.mcp import MCPClient');
      imports.add('from mcp import stdio_client, StdioServerParameters');
      imports.add('from mcp.client.streamable_http import streamablehttp_client');
      imports.add('from mcp.client.sse import sse_client');
    }

    // Check if swarm nodes are used
    const hasSwarmNodes = agentNodes.some(node => node.type === 'swarm');
    if (hasSwarmNodes) {
      imports.add('from strands.multiagent import Swarm');
    }

    // Generate custom tool code
    if (customToolNodes.length > 0) {
      customToolNodes.forEach(toolNode => {
        const toolCode = generateCustomToolCode(toolNode);
        code += toolCode + '\n\n';
      });
    }

    // Generate MCP client setup code
    if (mcpNodes.length > 0) {
      const mcpCode = generateMCPSetupCode(mcpNodes);
      code += mcpCode + '\n\n';
    }

    // Generate agent instances
    agentNodes.forEach((agentNode, index) => {
      const data = agentNode.data || {};
      const label = data.label || `Agent${index + 1}`;
      const modelProvider = data.modelProvider || 'AWS Bedrock';
      const modelId = data.modelId || 'us.anthropic.claude-3-7-sonnet-20250219-v1:0';
      const modelName = data.modelName || 'Claude 3.7 Sonnet';
      const systemPrompt = data.systemPrompt || 'You are a helpful AI assistant.';
      const temperature = data.temperature !== undefined ? data.temperature : 0.7;
      const maxTokens = data.maxTokens || 4000;
      const baseUrl = data.baseUrl || '';
      const thinkingEnabled = data.thinkingEnabled || false;
      const thinkingBudgetTokens = data.thinkingBudgetTokens || 2048;
      const reasoningEffort = data.reasoningEffort || 'medium';

      const modelIdentifier = modelProvider === 'AWS Bedrock' ? modelId : modelName;
      const agentVarName = sanitizePythonVariableName(label as string);

      // Find connected tools
      const connectedTools = findConnectedTools(agentNode, nodes, edges);
      const toolsCode = connectedTools.length > 0
        ? `,\n    tools=[${connectedTools.map(tool => tool.code).join(', ')}]`
        : '';

      // Generate model config
      const modelConfig = generateModelConfig(agentVarName, modelProvider as string, modelIdentifier as string, temperature as number, maxTokens as number, baseUrl as string, thinkingEnabled as boolean, thinkingBudgetTokens as number, reasoningEffort as string);

      code += `# ${label} Configuration\n`;
      code += modelConfig + '\n\n';
      code += `${agentVarName} = Agent(\n`;
      code += `    name="${label}",\n`;
      code += `    model=${agentVarName}_model,\n`;
      code += `    system_prompt="""${escapePythonTripleQuotedString(String(systemPrompt || 'You are a helpful AI agent.'))}"""${toolsCode},\n`;
      code += `    callback_handler=None\n`;
      code += `)\n\n`;
    });

    // Generate graph construction
    code += '# Graph Construction\n';
    code += 'builder = GraphBuilder()\n\n';

    // Add nodes to graph
    agentNodes.forEach(agentNode => {
      const label = (agentNode.data?.label as string) || 'agent';
      const nodeId = sanitizePythonVariableName(label);
      code += `builder.add_node(${nodeId}, "${nodeId}")\n`;
    });

    code += '\n';

    // Add edges to graph (agent→agent dependency connections)
    const graphEdges = edges.filter(edge => {
      const sourceNode = nodes.find(n => n.id === edge.source);
      const targetNode = nodes.find(n => n.id === edge.target);
      return sourceNode && targetNode &&
             (sourceNode.type === 'agent' || sourceNode.type === 'orchestrator-agent' || sourceNode.type === 'swarm') &&
             (targetNode.type === 'agent' || targetNode.type === 'orchestrator-agent' || targetNode.type === 'swarm') &&
             edge.sourceHandle === 'output' &&
             edge.targetHandle === 'user-input';
    });

    graphEdges.forEach(edge => {
      const sourceNode = agentNodes.find(n => n.id === edge.source);
      const targetNode = agentNodes.find(n => n.id === edge.target);
      if (sourceNode && targetNode) {
        const sourceId = sanitizePythonVariableName((sourceNode.data?.label as string) || 'agent');
        const targetId = sanitizePythonVariableName((targetNode.data?.label as string) || 'agent');
        code += `builder.add_edge("${sourceId}", "${targetId}")\n`;
      }
    });

    code += '\n';

    // Set entry points (from GraphBuilder → Agent connections)
    if (validation.entryPoints.length > 0) {
      validation.entryPoints.forEach(agentId => {
        const agent = agentNodes.find(n => n.id === agentId);
        if (agent) {
          const agentLabel = agent.data?.label as string | undefined;
          const nodeId = sanitizePythonVariableName(agentLabel || 'agent');
          code += `builder.set_entry_point("${nodeId}")\n`;
        }
      });
      code += '\n';
    }

    // Build graph
    code += '# Build the graph\n';
    code += 'graph = builder.build()\n\n';

    // Collect all MCP clients used by agents in the graph
    const mcpClientsInGraph = new Set<string>();
    const agentMCPMappings: Array<{ agentVarName: string; mcpTools: Array<{ clientVarName: string; toolsVarName: string }> }> = [];

    agentNodes.forEach(agentNode => {
      const mcpTools = findConnectedMCPTools(agentNode, nodes, edges);
      if (mcpTools.length > 0) {
        const label = (agentNode.data?.label as string) || 'agent';
        const agentVarName = sanitizePythonVariableName(label);
        agentMCPMappings.push({ agentVarName, mcpTools });
        mcpTools.forEach(mcp => mcpClientsInGraph.add(mcp.clientVarName));
      }
    });

    // Generate main execution code
    code += '# Main execution\n';
    code += 'async def main(user_input_arg: str = None, messages_arg: str = None):\n';
    code += '    # User input from command-line arguments with priority: --messages > --user-input > default\n';
    code += '    if messages_arg is not None and messages_arg.strip():\n';
    code += '        try:\n';
    code += '            messages_list = json.loads(messages_arg)\n';
    code += '            user_input = messages_list\n';
    code += '        except (json.JSONDecodeError, KeyError, TypeError):\n';
    code += '            user_input = "Hello, how can you help me?"\n';
    code += '    elif user_input_arg is not None and user_input_arg.strip():\n';
    code += '        user_input = user_input_arg.strip()\n';
    code += '    else:\n';
    code += '        user_input = "Hello, how can you help me?"\n\n';

    // If MCP clients are used, wrap execution in context managers
    if (mcpClientsInGraph.size > 0) {
      const mcpClientsList = Array.from(mcpClientsInGraph).join(', ');
      code += `    # Use MCP clients in context managers for graph agents\n`;
      code += `    with ${mcpClientsList}:\n`;

      // Initialize MCP tools for each agent that uses them
      agentMCPMappings.forEach(({ agentVarName, mcpTools }) => {
        mcpTools.forEach(({ clientVarName, toolsVarName }) => {
          const serverName = mcpNodes.find(n => `${(n.data?.serverName as string || 'mcp_server').toLowerCase().replace(/[^a-z0-9]/g, '_')}_client_${n.id.slice(-4)}` === clientVarName)?.data?.serverName || 'MCP Server';
          code += `        # Initialize tools from MCP client ${serverName}\n`;
          code += `        ${toolsVarName} = ${clientVarName}.list_tools_sync()\n`;
          code += `        # Combine existing tools with MCP tools for agent ${agentVarName}\n`;
          code += `        ${agentVarName}.tool_registry.process_tools(${toolsVarName})\n`;
        });
      });

      code += '        # Execute graph\n';
      code += '        result = graph(user_input)\n\n';

      code += '        # Output results\n';
      code += '        print(f"Status: {result.status}")\n';
      code += '        print(f"Execution order: {[node.node_id for node in result.execution_order]}")\n';
      code += '        print(f"Total nodes: {result.total_nodes}")\n';
      code += '        print(f"Completed nodes: {result.completed_nodes}")\n';
      code += '        print(f"Failed nodes: {result.failed_nodes}")\n';
      code += '        print(f"Execution time: {result.execution_time}ms")\n\n';

      code += '        # Print individual node results\n';
      code += '        for node_id, node_result in result.results.items():\n';
      code += '            print(f"\\n=== {node_id} ===")\n';
      code += '            print(str(node_result.result))\n\n';

      code += '        return str(result)\n\n';
    } else {
      // No MCP clients, execute directly
      code += '    # Execute graph\n';
      code += '    result = graph(user_input)\n\n';

      code += '    # Output results\n';
      code += '    print(f"Status: {result.status}")\n';
      code += '    print(f"Execution order: {[node.node_id for node in result.execution_order]}")\n';
      code += '    print(f"Total nodes: {result.total_nodes}")\n';
      code += '    print(f"Completed nodes: {result.completed_nodes}")\n';
      code += '    print(f"Failed nodes: {result.failed_nodes}")\n';
      code += '    print(f"Execution time: {result.execution_time}ms")\n\n';

      code += '    # Print individual node results\n';
      code += '    for node_id, node_result in result.results.items():\n';
      code += '        print(f"\\n=== {node_id} ===")\n';
      code += '        print(str(node_result.result))\n\n';

      code += '    return str(result)\n\n';
    }

    code += 'if __name__ == "__main__":\n';
    code += '    parser = argparse.ArgumentParser(description=\'Execute Strands Graph\')\n';
    code += '    parser.add_argument(\'--user-input\', type=str, help=\'User input prompt\')\n';
    code += '    parser.add_argument(\'--messages\', type=str, help=\'JSON string of conversation messages\')\n\n';

    code += '    args = parser.parse_args()\n\n';

    code += '    user_input_param = args.user_input\n';
    code += '    messages_param = args.messages\n\n';

    code += '    asyncio.run(main(user_input_param, messages_param))';

  } catch (error) {
    errors.push(`Code generation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    code: code.trim(),
    imports: Array.from(imports),
    errors,
  };
}
