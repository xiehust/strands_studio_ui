import { useState, useRef, useCallback, useEffect } from 'react';

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  resizeFrom?: 'left' | 'right';
}

export function ResizablePanel({
  children,
  defaultWidth = 384, // w-96 equivalent
  minWidth = 240,
  maxWidth = 800,
  className = '',
  resizeFrom = 'left'
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    
    // Add cursor style to body during resize
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = resizeFrom === 'left' 
      ? startXRef.current - e.clientX  // For left resize, mouse moving left increases width
      : e.clientX - startXRef.current; // For right resize, mouse moving right increases width
    
    const newWidth = startWidthRef.current + deltaX;
    const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);
    setWidth(clampedWidth);
  }, [isResizing, minWidth, maxWidth, resizeFrom]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div 
      ref={panelRef}
      className={`relative flex-shrink-0 ${className}`}
      style={{ width: `${width}px` }}
    >
      {/* Resize handle */}
      <div
        className={`absolute top-0 bottom-0 w-1 cursor-col-resize z-10 group ${
          resizeFrom === 'left' ? 'left-0' : 'right-0'
        }`}
        onMouseDown={handleMouseDown}
      >
        {/* Visual indicator */}
        <div className={`h-full w-1 transition-colors ${
          isResizing 
            ? 'bg-blue-500' 
            : 'bg-transparent group-hover:bg-gray-300'
        }`} />
        
        {/* Wider hit area for easier grabbing */}
        <div className={`absolute top-0 bottom-0 w-3 ${
          resizeFrom === 'left' ? '-left-1' : '-right-1'
        }`} />
      </div>
      
      {/* Panel content */}
      <div className="h-full">
        {children}
      </div>
    </div>
  );
}