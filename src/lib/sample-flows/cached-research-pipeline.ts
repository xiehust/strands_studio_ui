import type { SampleFlow } from './types';

export const cachedResearchPipeline: SampleFlow = {
  id: 'cached-research-pipeline',
  name: 'Cached Research Pipeline',
  description:
    'A Graph Mode DAG (planner fans out to researcher and reviewer) where every agent has prompt caching enabled for messages — a cost-saving pattern for multi-agent pipelines.',
  level: 'advanced',
  graphMode: true,
  nodes: [
    {
      id: 'input-adv2-1',
      type: 'input',
      position: { x: 40, y: 120 },
      data: {
        label: 'User Input',
        inputType: 'user-prompt',
      },
    },
    {
      id: 'agent-adv2-planner',
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
        cacheMessages: true,
      },
    },
    {
      id: 'agent-adv2-researcher',
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
        cacheMessages: true,
      },
    },
    {
      id: 'agent-adv2-reviewer',
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
        cacheMessages: true,
      },
    },
    {
      id: 'output-adv2-1',
      type: 'output',
      position: { x: 380, y: 620 },
      data: {
        label: 'Output',
      },
    },
  ],
  edges: [
    {
      id: 'e-adv2-input-planner',
      source: 'input-adv2-1',
      target: 'agent-adv2-planner',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-adv2-planner-researcher',
      source: 'agent-adv2-planner',
      target: 'agent-adv2-researcher',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-adv2-planner-reviewer',
      source: 'agent-adv2-planner',
      target: 'agent-adv2-reviewer',
      sourceHandle: 'output',
      targetHandle: 'user-input',
    },
    {
      id: 'e-adv2-researcher-output',
      source: 'agent-adv2-researcher',
      target: 'output-adv2-1',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
    {
      id: 'e-adv2-reviewer-output',
      source: 'agent-adv2-reviewer',
      target: 'output-adv2-1',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
};
