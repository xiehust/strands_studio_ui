import { useState } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { Rocket, Cloud, Server } from 'lucide-react';
import { LambdaDeployPanel } from './lambda-deploy-panel';
import { AgentCoreDeployPanel } from './agentcore-deploy-panel';


interface DeployPanelProps {
  nodes: Node[];
  edges: Edge[];
  graphMode?: boolean;
  className?: string;
}

export function DeployPanel({ nodes, edges, graphMode = false, className = '' }: DeployPanelProps) {
  const [deploymentTarget, setDeploymentTarget] = useState<'agentcore' | 'lambda'>('agentcore');

  const handleTargetChange = (target: 'agentcore' | 'lambda') => {
    setDeploymentTarget(target);
  };

  return (
    <div className={`bg-white border-l border-gray-200 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Rocket className="w-4 h-4 text-purple-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Deploy Agent</h3>
        </div>
      </div>

      {/* Deployment Target Selection */}
      <div className="p-4 border-b border-gray-200">
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-900">Deployment Target</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleTargetChange('agentcore')}
              className={`flex items-center p-3 border rounded-lg transition-colors ${
                deploymentTarget === 'agentcore'
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Server className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">AWS AgentCore</span>
            </button>
            <button
              onClick={() => handleTargetChange('lambda')}
              className={`flex items-center p-3 border rounded-lg transition-colors ${
                deploymentTarget === 'lambda'
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Cloud className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">AWS Lambda</span>
            </button>
          </div>
        </div>
      </div>

      {/* Conditional Panel Content */}
      {deploymentTarget === 'lambda' ? (
        <LambdaDeployPanel nodes={nodes} edges={edges} graphMode={graphMode} />
      ) : (
        <AgentCoreDeployPanel nodes={nodes} edges={edges} graphMode={graphMode} />
      )}
    </div>
  );
}
