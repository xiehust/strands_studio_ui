import type { SampleFlow } from './types';

export const agentWithTools: SampleFlow = {
  id: 'agent-with-tools',
  name: 'Agent with Tools',
  description:
    'An agent equipped with the built-in calculator tool plus a custom Python @tool function (word counter). Shows both ways of giving an agent tools.',
  level: 'basic',
  graphMode: false,
  nodes: [
    {
      id: 'input-1002',
      type: 'input',
      position: { x: 40, y: 100 },
      data: {
        label: 'User Input',
        inputType: 'user-prompt',
      },
    },
    {
      id: 'agent-2002',
      type: 'agent',
      position: { x: 360, y: 80 },
      data: {
        label: 'Math Agent',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a math assistant. Use the calculator tool for arithmetic and the word_counter tool to count words when asked.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: false,
      },
    },
    {
      id: 'tool-4002',
      type: 'tool',
      position: { x: 40, y: 320 },
      data: {
        label: 'Calculator',
        toolType: 'built-in',
        toolName: 'calculator',
        description: 'Perform mathematical calculations',
      },
    },
    {
      id: 'ctool-5002',
      type: 'custom-tool',
      position: { x: 300, y: 340 },
      data: {
        label: 'Word Counter',
        pythonCode: 'def word_counter(text: str) -> str:\n    """Count the number of words in the provided text."""\n    word_count = len(text.split())\n    return f"Word count: {word_count}"',
      },
    },
    {
      id: 'output-3002',
      type: 'output',
      position: { x: 720, y: 100 },
      data: {
        label: 'Output',
      },
    },
  ],
  edges: [
    {
      id: 'e-1002-2002',
      source: 'input-1002',
      target: 'agent-2002',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-4002-2002',
      source: 'tool-4002',
      target: 'agent-2002',
      sourceHandle: 'tool-output',
      targetHandle: 'tools',
    },
    {
      id: 'e-5002-2002',
      source: 'ctool-5002',
      target: 'agent-2002',
      sourceHandle: 'tool-output',
      targetHandle: 'tools',
    },
    {
      id: 'e-2002-3002',
      source: 'agent-2002',
      target: 'output-3002',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
};
