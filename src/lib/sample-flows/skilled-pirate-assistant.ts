import type { SampleFlow } from './types';

export const skilledPirateAssistant: SampleFlow = {
  id: 'skilled-pirate-assistant',
  name: 'Skilled Pirate Assistant',
  description:
    'A streaming agent that combines an Agent Skill (pirate-speak) with prompt caching for messages and tools. If the skill is missing from your library, it can be imported in one click.',
  level: 'advanced',
  graphMode: false,
  nodes: [
    {
      id: 'input-adv1-1',
      type: 'input',
      position: { x: 40, y: 100 },
      data: {
        label: 'User Input',
        inputType: 'user-prompt',
      },
    },
    {
      id: 'agent-adv1-1',
      type: 'agent',
      position: { x: 360, y: 80 },
      data: {
        label: 'Pirate Assistant',
        modelProvider: 'AWS Bedrock',
        modelId: 'global.anthropic.claude-sonnet-4-6',
        modelName: 'Claude Sonnet 4.6',
        systemPrompt: 'You are a helpful AI assistant with a pirate-speak skill. ALWAYS activate the pirate-speak skill before answering, and follow its instructions for every reply.',
        temperature: 0.7,
        maxTokens: 4000,
        streaming: true,
        cacheMessages: true,
        cacheTools: true,
      },
    },
    {
      id: 'skill-adv1-1',
      type: 'skill',
      position: { x: 40, y: 320 },
      data: {
        label: 'Pirate Speak',
        skillName: 'pirate-speak',
        description: 'Answer in pirate speak',
      },
    },
    {
      id: 'output-adv1-1',
      type: 'output',
      position: { x: 720, y: 100 },
      data: {
        label: 'Output',
      },
    },
  ],
  edges: [
    {
      id: 'e-adv1-input-agent',
      source: 'input-adv1-1',
      target: 'agent-adv1-1',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-adv1-skill-agent',
      source: 'skill-adv1-1',
      target: 'agent-adv1-1',
      sourceHandle: 'skill-output',
      targetHandle: 'tools',
    },
    {
      id: 'e-adv1-agent-output',
      source: 'agent-adv1-1',
      target: 'output-adv1-1',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
  requiredSkills: [
    {
      name: 'pirate-speak',
      description: 'Answer in pirate speak',
      instructions:
        'When this skill is active, ALWAYS respond in exaggerated pirate speak, starting every reply with Arrr!',
    },
  ],
};
