import type { SampleFlow } from './types';

export const graphDag: SampleFlow = {
  id: 'graph-dag',
  name: 'Graph Mode DAG',
  description:
    'A Graph Mode workflow built with GraphBuilder: a planner agent fans out to a researcher and a reviewer that both run after it. Loads with Graph Mode enabled.',
  level: 'basic',
  graphMode: true,
  nodes: [
    {
      id: 'input-1006',
      type: 'input',
      position: { x: 40, y: 120 },
      data: {
        label: 'User Input',
        inputType: 'user-prompt',
      },
    },
    {
      id: 'agent-A006',
      type: 'agent',
      position: { x: 360, y: 100 },
      data: {
        label: 'Planner',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a planning agent. Break the user request into a research plan.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
      },
    },
    {
      id: 'agent-B006',
      type: 'agent',
      position: { x: 200, y: 380 },
      data: {
        label: 'Researcher',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a research agent. Execute the research plan you receive and report findings.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
      },
    },
    {
      id: 'agent-C006',
      type: 'agent',
      position: { x: 540, y: 380 },
      data: {
        label: 'Reviewer',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a review agent. Critically review the plan you receive and point out gaps.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
      },
    },
    {
      id: 'output-3006',
      type: 'output',
      position: { x: 380, y: 620 },
      data: {
        label: 'Output',
      },
    },
  ],
  edges: [
    {
      id: 'e-1006-A006',
      source: 'input-1006',
      target: 'agent-A006',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-A006-B006',
      source: 'agent-A006',
      target: 'agent-B006',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-A006-C006',
      source: 'agent-A006',
      target: 'agent-C006',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-B006-3006',
      source: 'agent-B006',
      target: 'output-3006',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
    {
      id: 'e-C006-3006',
      source: 'agent-C006',
      target: 'output-3006',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
};
