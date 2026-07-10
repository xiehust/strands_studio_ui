import type { SampleFlow } from './types';

export const singleAgent: SampleFlow = {
  id: 'single-agent',
  name: 'Single Agent',
  description:
    'The simplest possible flow: user input goes to one Bedrock agent and the answer appears in the output node. The best place to start.',
  level: 'basic',
  graphMode: false,
  nodes: [
    {
      id: 'input-1001',
      type: 'input',
      position: { x: 40, y: 120 },
      data: {
        label: 'User Input',
        inputType: 'user-prompt',
      },
    },
    {
      id: 'agent-2001',
      type: 'agent',
      position: { x: 360, y: 100 },
      data: {
        label: 'Assistant Agent',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a helpful AI assistant that answers user questions clearly and concisely.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
      },
    },
    {
      id: 'output-3001',
      type: 'output',
      position: { x: 720, y: 120 },
      data: {
        label: 'Output',
      },
    },
  ],
  edges: [
    {
      id: 'e-1001-2001',
      source: 'input-1001',
      target: 'agent-2001',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-2001-3001',
      source: 'agent-2001',
      target: 'output-3001',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
};
