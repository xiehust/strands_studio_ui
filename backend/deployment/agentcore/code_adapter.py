"""
Code Adapter for AgentCore Deployment
Handles adaptation of Strands agent code to AgentCore Runtime format.
"""
import re
import ast
import logging
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class CodeAnalysis:
    """Analysis result of Strands agent code"""
    has_streaming: bool = False
    has_mcp_tools: bool = False
    has_custom_tools: bool = False
    agent_definitions: List[str] = None
    tool_definitions: List[str] = None
    import_statements: List[str] = None
    main_function_body: List[str] = None
    
    def __post_init__(self):
        if self.agent_definitions is None:
            self.agent_definitions = []
        if self.tool_definitions is None:
            self.tool_definitions = []
        if self.import_statements is None:
            self.import_statements = []
        if self.main_function_body is None:
            self.main_function_body = []

class StrandsCodeAdapter:
    """Adapter for converting Strands agent code to AgentCore Runtime format"""
    
    def __init__(self):
        self.streaming_indicators = [
            'yield',
            'stream_async',
            'streaming=True'
        ]
        
        self.mcp_indicators = [
            'MCPClient',
            'stdio_client',
            'streamablehttp_client',
            'sse_client'
        ]

    def analyze_code(self, generated_code: str) -> CodeAnalysis:
        """Analyze the generated Strands code to understand its structure"""
        analysis = CodeAnalysis()
        
        lines = generated_code.split('\n')
        current_section = None
        
        for line in lines:
            stripped = line.strip()
            
            # Check for streaming indicators
            if any(indicator in line for indicator in self.streaming_indicators):
                analysis.has_streaming = True
            
            # Check for MCP tools
            if any(indicator in line for indicator in self.mcp_indicators):
                analysis.has_mcp_tools = True
            
            # Check for custom tools
            if '@tool' in line or 'def ' in line and 'tool' in line.lower():
                analysis.has_custom_tools = True
            
            # Categorize code sections
            if stripped.startswith(('import ', 'from ')):
                analysis.import_statements.append(line)
            elif 'Agent(' in line or 'agent =' in line.lower():
                analysis.agent_definitions.append(line)
            elif '@tool' in line or (current_section == 'tool' and stripped):
                if '@tool' in line:
                    current_section = 'tool'
                analysis.tool_definitions.append(line)
            elif 'async def main():' in line:
                current_section = 'main'
            elif current_section == 'main' and stripped:
                analysis.main_function_body.append(line)
            elif not stripped:
                current_section = None
        
        logger.info(f"Code analysis: streaming={analysis.has_streaming}, "
                   f"mcp={analysis.has_mcp_tools}, custom_tools={analysis.has_custom_tools}")
        
        return analysis

    def adapt_for_agentcore(
        self, 
        generated_code: str, 
        target_format: str = "both"  # "sync", "streaming", or "both"
    ) -> Dict[str, str]:
        """
        Adapt Strands code for AgentCore Runtime format.
        
        Args:
            generated_code: Original Strands agent code
            target_format: Target format ("sync", "streaming", or "both")
            
        Returns:
            Dictionary with adapted code sections
        """
        analysis = self.analyze_code(generated_code)
        
        # Extract core components
        agent_setup = self._extract_agent_setup(generated_code, analysis)
        tool_definitions = self._extract_tool_definitions(generated_code, analysis)
        main_logic = self._extract_main_logic(generated_code, analysis)
        
        result = {}
        
        if target_format in ["sync", "both"]:
            result["sync_code"] = self._generate_sync_code(
                agent_setup, tool_definitions, main_logic, analysis
            )
        
        if target_format in ["streaming", "both"]:
            result["streaming_code"] = self._generate_streaming_code(
                agent_setup, tool_definitions, main_logic, analysis
            )
        
        return result

    def _extract_agent_setup(self, code: str, analysis: CodeAnalysis) -> str:
        """Extract agent configuration and setup code"""
        lines = code.split('\n')
        setup_lines = []
        indent = "        "  # AgentCore runtime indentation
        
        in_agent_section = False
        
        for line in lines:
            stripped = line.strip()
            
            # Skip imports and main function
            if stripped.startswith(('import ', 'from ', 'async def main', 'if __name__')):
                continue
            
            # Include agent-related definitions
            if any(keyword in line.lower() for keyword in ['model', 'agent', 'bedrock', 'openai']):
                in_agent_section = True
            
            if in_agent_section and stripped:
                # Adjust indentation for AgentCore runtime
                if line.startswith('    '):
                    setup_lines.append(indent + line[4:])
                elif stripped:
                    setup_lines.append(indent + stripped)
            elif not stripped and in_agent_section:
                setup_lines.append("")
                in_agent_section = False
        
        return '\n'.join(setup_lines)

    def _extract_tool_definitions(self, code: str, analysis: CodeAnalysis) -> str:
        """Extract custom tool definitions"""
        if not analysis.has_custom_tools:
            return ""
        
        lines = code.split('\n')
        tool_lines = []
        indent = "        "
        
        in_tool_definition = False
        
        for line in lines:
            stripped = line.strip()
            
            if '@tool' in line:
                in_tool_definition = True
            
            if in_tool_definition:
                if line.startswith('    '):
                    tool_lines.append(indent + line[4:])
                elif stripped:
                    tool_lines.append(indent + stripped)
                
                # End of function definition
                if stripped and not line.startswith(' ') and not line.startswith('\t') and '@tool' not in line:
                    in_tool_definition = False
        
        return '\n'.join(tool_lines)

    def _extract_main_logic(self, code: str, analysis: CodeAnalysis) -> str:
        """Extract main execution logic"""
        lines = code.split('\n')
        main_lines = []
        indent = "        "
        
        in_main_function = False
        
        for line in lines:
            stripped = line.strip()
            
            if 'async def main():' in line:
                in_main_function = True
                continue
            
            if in_main_function:
                if line.startswith('    ') and stripped:
                    main_lines.append(indent + line[4:])
                elif not stripped:
                    continue
                elif not line.startswith(' '):
                    break
        
        return '\n'.join(main_lines)

    def _generate_sync_code(
        self, 
        agent_setup: str, 
        tool_definitions: str, 
        main_logic: str, 
        analysis: CodeAnalysis
    ) -> str:
        """Generate synchronous execution code for AgentCore"""
        code_parts = []
        
        # Add tool definitions first
        if tool_definitions:
            code_parts.append(tool_definitions)
            code_parts.append("")
        
        # Add agent setup
        if agent_setup:
            code_parts.append(agent_setup)
            code_parts.append("")
        
        # Add main execution logic
        if main_logic:
            # Check if main_logic contains streaming code and convert if needed
            if analysis.has_streaming and ('yield' in main_logic or 'stream_async' in main_logic):
                sync_logic = self._convert_streaming_to_sync(main_logic)
                code_parts.append(sync_logic)
            else:
                code_parts.append(main_logic)
        else:
            # Fallback execution logic
            code_parts.extend([
                "        # Use input_data if provided, otherwise use prompt",
                "        user_input = input_data if input_data else prompt",
                "        ",
                "        # Execute the main agent",
                "        if 'main_agent' in locals():",
                "            response = main_agent(user_input)",
                "            return str(response)",
                "        else:",
                "            return f'Agent not found. Received: {user_input}'"
            ])
        
        return '\n'.join(code_parts)

    def _generate_streaming_code(
        self, 
        agent_setup: str, 
        tool_definitions: str, 
        main_logic: str, 
        analysis: CodeAnalysis
    ) -> str:
        """Generate streaming execution code for AgentCore"""
        code_parts = []
        
        # Add tool definitions first
        if tool_definitions:
            code_parts.append(tool_definitions)
            code_parts.append("")
        
        # Add agent setup (ensure callback_handler=None for streaming)
        if agent_setup:
            # Modify agent setup to ensure proper streaming configuration
            modified_setup = self._modify_agent_for_streaming(agent_setup)
            code_parts.append(modified_setup)
            code_parts.append("")
        
        # Add streaming execution logic
        if analysis.has_streaming and main_logic:
            # Use existing streaming logic but ensure it's generator-compatible
            streaming_logic = self._convert_to_streaming_generator(main_logic)
            code_parts.append(streaming_logic)
        else:
            # Generate streaming logic
            code_parts.extend([
                "        # Use input_data if provided, otherwise use prompt",
                "        user_input = input_data if input_data else prompt",
                "        ",
                "        # Execute the main agent with streaming",
                "        if 'main_agent' in locals():",
                "            async for chunk in main_agent.stream_async(user_input):",
                "                yield json.dumps({'chunk': str(chunk)})",
                "        else:",
                "            yield json.dumps({'error': 'Agent not found', 'input': user_input})"
            ])
        
        return '\n'.join(code_parts)

    def _convert_to_streaming_generator(self, main_logic: str) -> str:
        """Convert main logic to streaming generator format"""
        lines = main_logic.split('\n')
        converted_lines = []

        for line in lines:
            # Replace return statements with yield in async generators
            if 'return ' in line and 'yield' not in line:
                # Convert return to yield for streaming
                indent = len(line) - len(line.lstrip())
                yield_line = ' ' * indent + line.strip().replace('return ', 'yield json.dumps({"result": ') + '})'
                converted_lines.append(yield_line)
            else:
                converted_lines.append(line)

        return '\n'.join(converted_lines)

    def _convert_streaming_to_sync(self, streaming_code: str) -> str:
        """Convert streaming code to synchronous version"""
        lines = streaming_code.split('\n')
        converted_lines = []
        in_async_for_loop = False

        for line in lines:
            stripped = line.strip()

            # Check if we're entering an async for loop
            if 'async for' in line and 'main_agent.stream_async(' in line:
                in_async_for_loop = True
                indent = len(line) - len(line.lstrip())
                # Extract the agent call
                agent_call = line.split('main_agent.stream_async(')[1].split(')')[0]
                sync_line = ' ' * indent + f'response = main_agent({agent_call})'
                converted_lines.append(sync_line)
                converted_lines.append(' ' * indent + 'return str(response)')
                continue

            # Skip lines inside async for loop (they're replaced by the sync call above)
            if in_async_for_loop:
                if stripped.startswith('yield'):
                    # End of async for loop content
                    in_async_for_loop = False
                continue

            # Convert standalone yield statements to return
            if 'yield' in line and 'async for' not in line:
                indent = len(line) - len(line.lstrip())
                # Extract the yielded value
                yield_content = stripped.replace('yield ', '')
                if 'json.dumps(' in yield_content:
                    # Extract content from json.dumps
                    content = yield_content.replace('json.dumps(', '').rstrip(')')
                    return_line = ' ' * indent + f'return {content}'
                else:
                    return_line = ' ' * indent + f'return {yield_content}'
                converted_lines.append(return_line)
            else:
                converted_lines.append(line)

        return '\n'.join(converted_lines)

    def _modify_agent_for_streaming(self, agent_setup: str) -> str:
        """Modify agent setup to ensure proper streaming configuration"""
        lines = agent_setup.split('\n')
        modified_lines = []
        
        for line in lines:
            # Ensure callback_handler=None is set for streaming
            if 'Agent(' in line and 'callback_handler' not in line:
                # Add callback_handler=None to Agent initialization
                if line.rstrip().endswith(','):
                    modified_lines.append(line)
                    modified_lines.append(line[:line.index('Agent(')] + "    callback_handler=None")
                else:
                    # Insert before closing parenthesis
                    if ')' in line:
                        insert_pos = line.rfind(')')
                        new_line = line[:insert_pos] + ",\n" + line[:line.index('Agent(')] + "    callback_handler=None" + line[insert_pos:]
                        modified_lines.append(new_line)
                    else:
                        modified_lines.append(line)
            else:
                modified_lines.append(line)
        
        return '\n'.join(modified_lines)

    def inject_into_template(
        self, 
        template_content: str, 
        adapted_code: Dict[str, str],
        target_function: str = "execute_strands_agent"
    ) -> str:
        """
        Inject adapted code into AgentCore runtime template.
        
        Args:
            template_content: Original template content
            adapted_code: Adapted code from adapt_for_agentcore()
            target_function: Target function to inject into
            
        Returns:
            Modified template with injected code
        """
        # Determine which code to use
        if "streaming_code" in adapted_code and "sync_code" in adapted_code:
            # Use sync code for main function, streaming code for streaming function
            sync_injection = adapted_code["sync_code"]
            streaming_injection = adapted_code["streaming_code"]
        elif "sync_code" in adapted_code:
            sync_injection = adapted_code["sync_code"]
            streaming_injection = adapted_code["sync_code"]  # Fallback
        elif "streaming_code" in adapted_code:
            # Only streaming code available - create sync version and use streaming for streaming function
            streaming_injection = adapted_code["streaming_code"]
            # Convert streaming code to sync for the sync function
            sync_injection = self._convert_streaming_to_sync(adapted_code["streaming_code"])
        else:
            sync_injection = ""
            streaming_injection = ""
        
        # Inject into sync function
        template_content = self._inject_code_section(
            template_content, 
            sync_injection, 
            "execute_strands_agent"
        )
        
        # Inject into streaming function
        template_content = self._inject_code_section(
            template_content, 
            streaming_injection, 
            "execute_strands_agent_streaming"
        )
        
        return template_content

    def _inject_code_section(
        self, 
        template: str, 
        injection_code: str, 
        function_name: str
    ) -> str:
        """Inject code into a specific function in the template"""
        placeholder = "        # This is a placeholder - the actual generated code will be injected here"
        end_placeholder = "        # Default simple agent for testing"
        
        if placeholder in template:
            parts = template.split(placeholder)
            if len(parts) == 2:
                second_parts = parts[1].split(end_placeholder)
                if len(second_parts) >= 2:
                    return (
                        parts[0] +
                        "        # Generated Strands agent code\n" +
                        injection_code +
                        "\n        # End of generated code\n        " +
                        end_placeholder +
                        end_placeholder.join(second_parts[1:])
                    )
        
        # Fallback: simple replacement
        return template.replace(placeholder, injection_code)
