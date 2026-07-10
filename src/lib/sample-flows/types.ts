import type { Node, Edge } from '@xyflow/react';

/** Inline skill definition shipped with a sample so it can be imported on demand. */
export interface SampleSkillDefinition {
  name: string;
  description: string;
  instructions: string;
}

/** A preset flow that can be loaded onto the canvas from the sample gallery. */
export interface SampleFlow {
  id: string;
  name: string;
  description: string;
  level: 'basic' | 'advanced';
  graphMode: boolean;
  nodes: Node[];
  edges: Edge[];
  /** Skills that must exist in the skill library before this sample can run. */
  requiredSkills?: SampleSkillDefinition[];
}
