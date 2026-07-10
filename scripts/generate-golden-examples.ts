/**
 * Golden example generator for the AI codegen guidance assets.
 *
 * Runs the existing frontend template code generator (`generateStrandsAgentCode`)
 * against 6 representative flows and writes:
 *   - backend/codegen/guidance/examples/{key}.py        (generated Python code)
 *   - backend/codegen/guidance/examples/flows/{key}.json (the input flow JSON)
 *
 * Usage: npx tsx scripts/generate-golden-examples.ts
 *
 * The flow JSON schema matches the `generateStrandsAgentCode(nodes, edges, graphMode)`
 * input, and every edge respects the VALID_CONNECTIONS rules declared in
 * src/lib/connection-validator.ts. Node ids intentionally end with 4 alphanumeric
 * characters because the generator derives Python identifiers from `id.slice(-4)`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node, Edge } from '@xyflow/react';
import { generateStrandsAgentCode } from '../src/lib/code-generator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.resolve(__dirname, '../backend/codegen/guidance/examples');
const FLOWS_DIR = path.join(EXAMPLES_DIR, 'flows');

interface FlowDefinition {
  key: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  graph_mode: boolean;
}

const BEDROCK_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';
const BEDROCK_MODEL_NAME = 'Claude Sonnet 4.6';

/** Shared agent data defaults matching property-panel.tsx defaults. */
function agentData(label: string, systemPrompt: string, overrides: Record<string, unknown> = {}) {
  return {
    label,
    modelProvider: 'AWS Bedrock',
    modelId: BEDROCK_MODEL_ID,
    modelName: BEDROCK_MODEL_NAME,
    systemPrompt,
    temperature: 0.7,
    maxTokens: 4000,
    streaming: false,
    ...overrides,
  };
}

const pos = (x: number, y: number) => ({ x, y });

const flows: FlowDefinition[] = [
  // 1. single_agent: input -> agent -> output (Bedrock model)
  {
    key: 'single_agent',
    description: 'Single Bedrock agent: input -> agent -> output',
    graph_mode: false,
    nodes: [
      { id: 'input-1001', type: 'input', position: pos(0, 100), data: { label: 'User Input', inputType: 'user-prompt' } },
      {
        id: 'agent-2001', type: 'agent', position: pos(300, 100),
        data: agentData('Assistant Agent', 'You are a helpful AI assistant that answers user questions clearly and concisely.'),
      },
      { id: 'output-3001', type: 'output', position: pos(600, 100), data: { label: 'Output' } },
    ],
    edges: [
      { id: 'e-1001-2001', source: 'input-1001', target: 'agent-2001', sourceHandle: 'output', targetHandle: 'user-input' },
      { id: 'e-2001-3001', source: 'agent-2001', target: 'output-3001', sourceHandle: 'output', targetHandle: 'input' },
    ],
  },

  // 2. agent_tools: agent with one built-in tool (calculator) and one custom tool
  {
    key: 'agent_tools',
    description: 'Agent with built-in calculator tool and a custom @tool function',
    graph_mode: false,
    nodes: [
      { id: 'input-1002', type: 'input', position: pos(0, 100), data: { label: 'User Input', inputType: 'user-prompt' } },
      {
        id: 'agent-2002', type: 'agent', position: pos(300, 100),
        data: agentData('Math Agent', 'You are a math assistant. Use the calculator tool for arithmetic and the word_counter tool to count words when asked.'),
      },
      {
        id: 'tool-4002', type: 'tool', position: pos(0, 300),
        data: { label: 'Calculator', toolType: 'built-in', toolName: 'calculator', description: 'Perform mathematical calculations' },
      },
      {
        id: 'ctool-5002', type: 'custom-tool', position: pos(150, 300),
        data: {
          label: 'Word Counter',
          pythonCode: 'def word_counter(text: str) -> str:\n    """Count the number of words in the provided text."""\n    word_count = len(text.split())\n    return f"Word count: {word_count}"',
        },
      },
      { id: 'output-3002', type: 'output', position: pos(600, 100), data: { label: 'Output' } },
    ],
    edges: [
      { id: 'e-1002-2002', source: 'input-1002', target: 'agent-2002', sourceHandle: 'output', targetHandle: 'user-input' },
      { id: 'e-4002-2002', source: 'tool-4002', target: 'agent-2002', sourceHandle: 'tool-output', targetHandle: 'tools' },
      { id: 'e-5002-2002', source: 'ctool-5002', target: 'agent-2002', sourceHandle: 'tool-output', targetHandle: 'tools' },
      { id: 'e-2002-3002', source: 'agent-2002', target: 'output-3002', sourceHandle: 'output', targetHandle: 'input' },
    ],
  },

  // 3. agent_mcp: agent with one MCP tool over streamable_http transport
  {
    key: 'agent_mcp',
    description: 'Agent with one MCP server (streamable_http transport)',
    graph_mode: false,
    nodes: [
      { id: 'input-1003', type: 'input', position: pos(0, 100), data: { label: 'User Input', inputType: 'user-prompt' } },
      {
        id: 'agent-2003', type: 'agent', position: pos(300, 100),
        data: agentData('Docs Agent', 'You are a documentation assistant. Use the available MCP tools to search and fetch documentation before answering.'),
      },
      {
        id: 'mcp-6003', type: 'mcp-tool', position: pos(0, 300),
        data: {
          label: 'Docs MCP Server',
          serverName: 'docs_server',
          transportType: 'streamable_http',
          url: 'http://localhost:8811/mcp',
          timeout: 30,
          description: 'Documentation search MCP server',
        },
      },
      { id: 'output-3003', type: 'output', position: pos(600, 100), data: { label: 'Output' } },
    ],
    edges: [
      { id: 'e-1003-2003', source: 'input-1003', target: 'agent-2003', sourceHandle: 'output', targetHandle: 'user-input' },
      { id: 'e-6003-2003', source: 'mcp-6003', target: 'agent-2003', sourceHandle: 'mcp-tools', targetHandle: 'tools' },
      { id: 'e-2003-3003', source: 'agent-2003', target: 'output-3003', sourceHandle: 'output', targetHandle: 'input' },
    ],
  },

  // 4. orchestrator: orchestrator-agent coordinating two sub-agents (agent-as-tool pattern)
  {
    key: 'orchestrator',
    description: 'Orchestrator agent with two sub-agents exposed as @tool functions',
    graph_mode: false,
    nodes: [
      { id: 'input-1004', type: 'input', position: pos(0, 100), data: { label: 'User Input', inputType: 'user-prompt' } },
      {
        id: 'orch-7004', type: 'orchestrator-agent', position: pos(300, 100),
        data: agentData(
          'Coordinator',
          'You are an orchestrator agent that coordinates specialized agents to complete complex tasks.',
          { coordinationPrompt: 'Delegate research questions to the Research Agent tool and writing tasks to the Writer Agent tool, then combine their results into a final answer.' },
        ),
      },
      {
        id: 'agent-8004', type: 'agent', position: pos(150, 320),
        data: agentData('Research Agent', 'You are a research specialist. Gather relevant facts and background information for the given topic.'),
      },
      {
        id: 'agent-9004', type: 'agent', position: pos(450, 320),
        data: agentData('Writer Agent', 'You are a writing specialist. Turn provided facts into clear, well-structured prose.'),
      },
      { id: 'output-3004', type: 'output', position: pos(600, 100), data: { label: 'Output' } },
    ],
    edges: [
      { id: 'e-1004-7004', source: 'input-1004', target: 'orch-7004', sourceHandle: 'output', targetHandle: 'user-input' },
      { id: 'e-7004-8004', source: 'orch-7004', target: 'agent-8004', sourceHandle: 'sub-agents', targetHandle: 'orchestrator-input' },
      { id: 'e-7004-9004', source: 'orch-7004', target: 'agent-9004', sourceHandle: 'sub-agents', targetHandle: 'orchestrator-input' },
      { id: 'e-7004-3004', source: 'orch-7004', target: 'output-3004', sourceHandle: 'output', targetHandle: 'input' },
    ],
  },

  // 5. swarm: swarm node with three member agents
  {
    key: 'swarm',
    description: 'Swarm with three member agents (self-organizing collaboration)',
    graph_mode: false,
    nodes: [
      { id: 'input-1005', type: 'input', position: pos(0, 100), data: { label: 'User Input', inputType: 'user-prompt' } },
      {
        id: 'swarm-A005', type: 'swarm', position: pos(300, 100),
        data: {
          label: 'Research Swarm',
          maxHandoffs: 20,
          maxIterations: 20,
          executionTimeout: 900,
          nodeTimeout: 300,
          repetitiveHandoffDetectionWindow: 0,
          repetitiveHandoffMinUniqueAgents: 0,
        },
      },
      {
        id: 'agent-B005', type: 'agent', position: pos(100, 320),
        data: agentData('Researcher', 'You are a researcher in a swarm. Gather facts about the topic and hand off to the analyst when done.'),
      },
      {
        id: 'agent-C005', type: 'agent', position: pos(300, 320),
        data: agentData('Analyst', 'You are an analyst in a swarm. Analyze the gathered facts and hand off to the writer for the final summary.'),
      },
      {
        id: 'agent-D005', type: 'agent', position: pos(500, 320),
        data: agentData('Writer', 'You are a writer in a swarm. Produce the final, polished answer from the analysis.'),
      },
      { id: 'output-3005', type: 'output', position: pos(600, 100), data: { label: 'Output' } },
    ],
    edges: [
      { id: 'e-1005-A005', source: 'input-1005', target: 'swarm-A005', sourceHandle: 'output', targetHandle: 'user-input' },
      { id: 'e-A005-B005', source: 'swarm-A005', target: 'agent-B005', sourceHandle: 'sub-agents', targetHandle: 'orchestrator-input' },
      { id: 'e-A005-C005', source: 'swarm-A005', target: 'agent-C005', sourceHandle: 'sub-agents', targetHandle: 'orchestrator-input' },
      { id: 'e-A005-D005', source: 'swarm-A005', target: 'agent-D005', sourceHandle: 'sub-agents', targetHandle: 'orchestrator-input' },
      { id: 'e-A005-3005', source: 'swarm-A005', target: 'output-3005', sourceHandle: 'output', targetHandle: 'input' },
    ],
  },

  // 6. graph: graph mode DAG with three agents (A -> B, A -> C)
  {
    key: 'graph',
    description: 'Graph mode DAG: Planner -> Researcher, Planner -> Reviewer (GraphBuilder)',
    graph_mode: true,
    nodes: [
      { id: 'input-1006', type: 'input', position: pos(0, 100), data: { label: 'User Input', inputType: 'user-prompt' } },
      {
        id: 'agent-A006', type: 'agent', position: pos(300, 100),
        data: agentData('Planner', 'You are a planning agent. Break the user request into a research plan.'),
      },
      {
        id: 'agent-B006', type: 'agent', position: pos(200, 320),
        data: agentData('Researcher', 'You are a research agent. Execute the research plan you receive and report findings.'),
      },
      {
        id: 'agent-C006', type: 'agent', position: pos(400, 320),
        data: agentData('Reviewer', 'You are a review agent. Critically review the plan you receive and point out gaps.'),
      },
      { id: 'output-3006', type: 'output', position: pos(300, 540), data: { label: 'Output' } },
    ],
    edges: [
      { id: 'e-1006-A006', source: 'input-1006', target: 'agent-A006', sourceHandle: 'output', targetHandle: 'user-input' },
      // Graph mode dependency edges: agent output -> agent user-input
      { id: 'e-A006-B006', source: 'agent-A006', target: 'agent-B006', sourceHandle: 'output', targetHandle: 'user-input' },
      { id: 'e-A006-C006', source: 'agent-A006', target: 'agent-C006', sourceHandle: 'output', targetHandle: 'user-input' },
      { id: 'e-B006-3006', source: 'agent-B006', target: 'output-3006', sourceHandle: 'output', targetHandle: 'input' },
      { id: 'e-C006-3006', source: 'agent-C006', target: 'output-3006', sourceHandle: 'output', targetHandle: 'input' },
    ],
  },
];

/**
 * Post-generation fixups applied to template generator output after human review.
 *
 * KNOWN GENERATOR BUG (documented, intentionally NOT fixed in src/lib/code-generator.ts):
 * When an orchestrator-agent is the execution agent (connected to the input node)
 * and the flow contains no MCP tools, `generateStrandsAgentCode` emits only the
 * orchestrator's model config (`generateOrchestratorModelOnly`) — the
 * `coordinator = Agent(...)` construction is only emitted inside main() on the
 * hasMCPTools branch (code-generator.ts:556+). The resulting code raises
 * NameError at runtime. Golden examples must be correct reference code for the
 * coding agent, so we insert the missing Agent construction here, mirroring the
 * exact style `generateOrchestratorCode` uses for non-execution orchestrators.
 */
function applyFixups(key: string, code: string): string {
  if (key === 'orchestrator' && !code.includes('coordinator = Agent(')) {
    const anchor = '\n# Main execution\n';
    const agentConstruction = `
coordinator = Agent(
    model=coordinator_model,
    system_prompt="""You are an orchestrator agent that coordinates specialized agents to complete complex tasks.

Coordination Instructions: Delegate research questions to the Research Agent tool and writing tasks to the Writer Agent tool, then combine their results into a final answer.""",
    tools=[research_agent_8004, writer_agent_9004],
    callback_handler=None
)
`;
    if (code.includes(anchor)) {
      return code.replace(anchor, agentConstruction + anchor);
    }
    console.warn('[orchestrator] fixup anchor not found; output left unpatched');
  }
  return code;
}

function main() {
  fs.mkdirSync(FLOWS_DIR, { recursive: true });

  let failed = false;

  for (const flow of flows) {
    const result = generateStrandsAgentCode(flow.nodes, flow.edges, flow.graph_mode);

    if (result.errors.length > 0) {
      console.error(`[${flow.key}] generation errors:`);
      result.errors.forEach(err => console.error(`  - ${err}`));
      failed = true;
      continue;
    }

    // Assemble the full file the same way code-panel.tsx does:
    // imports joined by newline, blank line, then the generated body.
    const fullCode = applyFixups(flow.key, result.imports.join('\n') + '\n\n' + result.code + '\n');

    const pyPath = path.join(EXAMPLES_DIR, `${flow.key}.py`);
    fs.writeFileSync(pyPath, fullCode, 'utf-8');

    const flowJson = {
      description: flow.description,
      nodes: flow.nodes,
      edges: flow.edges,
      graph_mode: flow.graph_mode,
    };
    const jsonPath = path.join(FLOWS_DIR, `${flow.key}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(flowJson, null, 2) + '\n', 'utf-8');

    console.log(`[${flow.key}] wrote ${path.relative(process.cwd(), pyPath)} (${fullCode.split('\n').length} lines) and ${path.relative(process.cwd(), jsonPath)}`);
  }

  if (failed) {
    process.exit(1);
  }
  console.log('\nAll golden examples generated.');
}

main();
