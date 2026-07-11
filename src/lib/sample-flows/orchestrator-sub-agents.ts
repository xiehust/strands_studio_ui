import type { SampleFlow } from './types';

export const orchestratorSubAgents: SampleFlow = {
  id: 'orchestrator-sub-agents',
  name: 'Orchestrator with Sub-Agents',
  description:
    'A coordinator agent that delegates work to two specialized sub-agents (research and writing) exposed as @tool functions, then combines their results.',
  level: 'basic',
  graphMode: false,
  nodes: [
    {
      id: 'input-1004',
      type: 'input',
      position: { x: 40, y: 100 },
      data: {
        label: 'User Input',
        inputType: 'user-prompt',
      },
    },
    {
      id: 'orch-7004',
      type: 'orchestrator-agent',
      position: { x: 360, y: 80 },
      data: {
        label: 'Coordinator',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are an orchestrator agent that coordinates specialized agents to complete complex tasks.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
        coordinationPrompt: 'Delegate research questions to the Research Agent tool and writing tasks to the Writer Agent tool, then combine their results into a final answer.',
      },
    },
    {
      id: 'agent-8004',
      type: 'agent',
      position: { x: 180, y: 360 },
      data: {
        label: 'Research Agent',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a research specialist. Gather relevant facts and background information for the given topic.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
      },
    },
    {
      id: 'agent-9004',
      type: 'agent',
      position: { x: 540, y: 360 },
      data: {
        label: 'Writer Agent',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a writing specialist. Turn provided facts into clear, well-structured prose.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
      },
    },
    {
      id: 'output-3004',
      type: 'output',
      position: { x: 720, y: 100 },
      data: {
        label: 'Output',
      },
    },
  ],
  edges: [
    {
      id: 'e-1004-7004',
      source: 'input-1004',
      target: 'orch-7004',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-7004-8004',
      source: 'orch-7004',
      target: 'agent-8004',
      sourceHandle: 'sub-agents',
      targetHandle: 'orchestrator-input',
    },
    {
      id: 'e-7004-9004',
      source: 'orch-7004',
      target: 'agent-9004',
      sourceHandle: 'sub-agents',
      targetHandle: 'orchestrator-input',
    },
    {
      id: 'e-7004-3004',
      source: 'orch-7004',
      target: 'output-3004',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
};
