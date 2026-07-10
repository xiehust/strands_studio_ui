import React from 'react';
import { Bot, Wrench, ArrowRight, ArrowLeft, Code, Server, Crown, Users } from 'lucide-react';

interface NodeTypeItem {
  type: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  category: string;
}

const nodeTypes: NodeTypeItem[] = [
  {
    type: 'agent',
    label: 'Agent Node',
    icon: Bot,
    description: 'Strands Agent with configurable model and settings',
    category: 'Core',
  },
  {
    type: 'orchestrator-agent',
    label: 'Orchestrator Agent',
    icon: Crown,
    description: 'Orchestrates multiple agents as tools for complex workflows',
    category: 'Advanced',
  },
  {
    type: 'swarm',
    label: 'Swarm Node',
    icon: Users,
    description: 'Multi-agent swarm with handoff capabilities and coordination',
    category: 'Advanced',
  },
  {
    type: 'tool',
    label: 'Tool Node', 
    icon: Wrench,
    description: 'Built-in or custom tool for agent capabilities',
    category: 'Core',
  },
  {
    type: 'mcp-tool',
    label: 'MCP Server',
    icon: Server,
    description: 'Model Context Protocol server for external tools',
    category: 'Core',
  },
  {
    type: 'input',
    label: 'Input Node',
    icon: ArrowRight,
    description: 'Input prompt or data source',
    category: 'IO',
  },
  {
    type: 'output',
    label: 'Output Node',
    icon: ArrowLeft,
    description: 'Output response or data destination',
    category: 'IO',
  },
  {
    type: 'custom-tool',
    label: 'Custom Tool',
    icon: Code,
    description: 'Define custom tools with Python code',
    category: 'Core',
  },
];

const categories = ['Core', 'IO', 'Advanced'];

interface NodePaletteProps {
  className?: string;
}

const accentByType: Record<string, string> = {
  agent: 'text-amber',
  'orchestrator-agent': 'text-s5',
  swarm: 'text-s5',
  tool: 'text-s2',
  'custom-tool': 'text-s2',
  'mcp-tool': 'text-s1',
  input: 'text-ink-2',
  output: 'text-ink-2',
};

export function NodePalette({ className = '' }: NodePaletteProps) {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  let idx = 0;

  return (
    <div className={`bg-panel border-r border-line py-4 overflow-y-auto flex flex-col ${className}`}>
      <div className="px-4 mb-3">
        <div className="lp-kicker mb-1">// MODULE LIBRARY</div>
        <h2 className="lp-title text-sm text-ink uppercase tracking-wider">Node Palette</h2>
      </div>

      {categories.map((category) => {
        const categoryNodes = nodeTypes.filter((node) => node.category === category);

        return (
          <div key={category} className="mb-3">
            <div className="lp-side-label">{category}</div>
            <div>
              {categoryNodes.map((nodeType) => {
                idx += 1;
                const IconComponent = nodeType.icon;

                return (
                  <div
                    key={nodeType.type}
                    className="lp-nav-item"
                    draggable
                    onDragStart={(event) => onDragStart(event, nodeType.type)}
                    title={nodeType.description}
                  >
                    <span className="idx">{String(idx).padStart(2, '0')}</span>
                    <IconComponent className={`w-4 h-4 flex-shrink-0 ${accentByType[nodeType.type] || 'text-ink-2'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium leading-tight">{nodeType.label}</div>
                      <div className="text-[10px] font-mono text-ink-3 mt-0.5 truncate">{nodeType.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-auto px-4 pt-3 border-t border-line font-mono text-[9.5px] text-ink-3 leading-[1.9]">
        MODE <b className="text-ink-2 font-medium">DRAG → CANVAS</b><br />
        SDK <b className="text-ink-2 font-medium">strands-agents</b><br />
        TARGET <b className="text-ink-2 font-medium">bedrock-agentcore</b>
      </div>
    </div>
  );
}