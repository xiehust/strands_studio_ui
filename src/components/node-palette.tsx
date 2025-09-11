import React from 'react';
import { Bot, Wrench, ArrowRight, ArrowLeft, GitBranch, Code, Server } from 'lucide-react';

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
    type: 'control',
    label: 'Control Flow',
    icon: GitBranch,
    description: 'Conditional logic, loops, or flow control',
    category: 'Control',
  },
  {
    type: 'custom-tool',
    label: 'Custom Tool',
    icon: Code,
    description: 'Define custom tools with Python code',
    category: 'Advanced',
  },
];

const categories = ['Core', 'IO', 'Control', 'Advanced'];

interface NodePaletteProps {
  className?: string;
}

export function NodePalette({ className = '' }: NodePaletteProps) {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className={`bg-white border-r border-gray-200 p-4 overflow-y-auto ${className}`}>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Node Palette</h2>
      
      {categories.map((category) => {
        const categoryNodes = nodeTypes.filter((node) => node.category === category);
        
        return (
          <div key={category} className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">{category}</h3>
            <div className="space-y-2">
              {categoryNodes.map((nodeType) => {
                const IconComponent = nodeType.icon;
                
                return (
                  <div
                    key={nodeType.type}
                    className="flex items-center p-3 bg-gray-50 rounded-lg cursor-grab hover:bg-gray-100 transition-colors border border-gray-200 hover:border-gray-300"
                    draggable
                    onDragStart={(event) => onDragStart(event, nodeType.type)}
                    title={nodeType.description}
                  >
                    <IconComponent className="w-4 h-4 text-gray-600 mr-3 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{nodeType.label}</div>
                      <div className="text-xs text-gray-500 mt-1">{nodeType.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}