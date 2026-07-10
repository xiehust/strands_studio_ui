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
    <div className={`bg-white border-l border-gray-200 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Rocket className="w-4 h-4 text-purple-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Deploy Agent</h3>
          <span className="ml-2 text-xs text-gray-500">AWS Bedrock AgentCore</span>
        </div>
      </div>

      {/* AgentCore Deployment Panel */}
      <AgentCoreDeployPanel nodes={nodes} edges={edges} graphMode={graphMode} />
    </div>
  );
}
