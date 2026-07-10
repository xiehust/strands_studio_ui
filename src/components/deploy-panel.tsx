import { type Node, type Edge } from '@xyflow/react';
import { Rocket } from 'lucide-react';
import { AgentCoreDeployPanel } from './agentcore-deploy-panel';

// NOTE: Lambda and ECS Fargate deployment targets are disabled.
// Their panel components (lambda-deploy-panel.tsx, ecs-deploy-panel.tsx) are kept
// on disk but intentionally unimported. Backend routes are gated by the
// ENABLE_LEGACY_DEPLOY_TARGETS env var.

interface DeployPanelProps {
  nodes: Node[];
  edges: Edge[];
  graphMode?: boolean;
  className?: string;
}

export function DeployPanel({ nodes, edges, graphMode = false, className = '' }: DeployPanelProps) {
  return (
    <div className={`bg-panel border-l border-line flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="lp-phead">
        <Rocket className="w-4 h-4 text-amber" />
        <h3 className="lp-ptitle">Deploy Agent</h3>
        <span className="lp-sub">aws bedrock agentcore</span>
      </div>

      {/* AgentCore Deployment Panel */}
      <AgentCoreDeployPanel nodes={nodes} edges={edges} graphMode={graphMode} />
    </div>
  );
}
