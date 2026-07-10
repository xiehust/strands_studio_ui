from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import calculator, file_read, shell, current_time, http_request, editor, retrieve
import json
import os
import asyncio
import argparse
from strands.multiagent import Swarm

# Researcher Configuration
researcher_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

researcher = Agent(
    name="Researcher",
    model=researcher_model,
    system_prompt="""You are a researcher in a swarm. Gather facts about the topic and hand off to the analyst when done.""",
    callback_handler=None
)

# Analyst Configuration
analyst_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

analyst = Agent(
    name="Analyst",
    model=analyst_model,
    system_prompt="""You are an analyst in a swarm. Analyze the gathered facts and hand off to the writer for the final summary.""",
    callback_handler=None
)

# Writer Configuration
writer_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

writer = Agent(
    name="Writer",
    model=writer_model,
    system_prompt="""You are a writer in a swarm. Produce the final, polished answer from the analysis.""",
    callback_handler=None
)

# Research Swarm Configuration
research_swarm = Swarm(
    [researcher, analyst, writer],
    max_handoffs=20,
    max_iterations=20,
    execution_timeout=900.0,
    node_timeout=300.0,
    repetitive_handoff_detection_window=0,
    repetitive_handoff_min_unique_agents=0
)

# Main execution
async def main(user_input_arg: str = None, messages_arg: str = None):
    # Access the global variables
    global research_swarm
    # User input from command-line arguments with priority: --messages > --user-input > default
    if messages_arg is not None and messages_arg.strip():
        # Parse messages JSON and pass full conversation history to agent
        try:
            messages_list = json.loads(messages_arg)
            # Pass the full messages list to the agent
            user_input = messages_list[-1]['content']
        except (json.JSONDecodeError, KeyError, TypeError):
            user_input = "Hello, how can you help me?"
    elif user_input_arg is not None and user_input_arg.strip():
        user_input = user_input_arg.strip()
    else:
        # Default fallback when no input provided
        user_input = "Hello, how can you help me?"
    # Execute swarm (sync execution)
    result = research_swarm(user_input)
    print(f"Status: {result.status}")
    node_results = [ f"{node.node_id}:{result.results[node.node_id].result}" for node in result.node_history]
    print(f"Node history:\n{'\n'.join(node_results)}")
    return '\n'.join(node_results)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Swarm')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))
