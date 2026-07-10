import type { SampleFlow } from './types';
import { singleAgent } from './single-agent';
import { agentWithTools } from './agent-with-tools';
import { agentWithMcp } from './agent-with-mcp';
import { orchestratorSubAgents } from './orchestrator-sub-agents';
import { agentSwarm } from './agent-swarm';
import { graphDag } from './graph-dag';
import { skilledPirateAssistant } from './skilled-pirate-assistant';
import { cachedResearchPipeline } from './cached-research-pipeline';

export type { SampleFlow, SampleSkillDefinition } from './types';

export const SAMPLE_FLOWS: SampleFlow[] = [
  // Basic
  singleAgent,
  agentWithTools,
  agentWithMcp,
  orchestratorSubAgents,
  agentSwarm,
  graphDag,
  // Advanced
  skilledPirateAssistant,
  cachedResearchPipeline,
];
