from strands import Agent, tool
from strands.models import BedrockModel, CacheConfig
from strands.multiagent import GraphBuilder
from strands_tools import calculator, file_read, shell, current_time
import json
import os
import asyncio
import argparse

# Planner Configuration
planner_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

planner = Agent(
    name="Planner",
    model=planner_model,
    system_prompt="""You are a planning agent. Break the user request into a research plan.""",
    callback_handler=None
)

# Researcher Configuration
researcher_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

researcher = Agent(
    name="Researcher",
    model=researcher_model,
    system_prompt="""You are a research agent. Execute the research plan you receive and report findings.""",
    callback_handler=None
)

# Reviewer Configuration
reviewer_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

reviewer = Agent(
    name="Reviewer",
    model=reviewer_model,
    system_prompt="""You are a review agent. Critically review the plan you receive and point out gaps.""",
    callback_handler=None
)

# Graph Construction
builder = GraphBuilder()

builder.add_node(planner, "planner")
builder.add_node(researcher, "researcher")
builder.add_node(reviewer, "reviewer")

builder.add_edge("planner", "researcher")
builder.add_edge("planner", "reviewer")

builder.set_entry_point("planner")

# Build the graph
graph = builder.build()

# Main execution
async def main(user_input_arg: str = None, messages_arg: str = None):
    # User input from command-line arguments with priority: --messages > --user-input > default
    if messages_arg is not None and messages_arg.strip():
        try:
            messages_list = json.loads(messages_arg)
            user_input = messages_list
        except (json.JSONDecodeError, KeyError, TypeError):
            user_input = "Hello, how can you help me?"
    elif user_input_arg is not None and user_input_arg.strip():
        user_input = user_input_arg.strip()
    else:
        user_input = "Hello, how can you help me?"

    # Execute graph
    result = graph(user_input)

    # Output results
    print(f"Status: {result.status}")
    print(f"Execution order: {[node.node_id for node in result.execution_order]}")
    print(f"Total nodes: {result.total_nodes}")
    print(f"Completed nodes: {result.completed_nodes}")
    print(f"Failed nodes: {result.failed_nodes}")
    print(f"Execution time: {result.execution_time}ms")

    # Print individual node results
    for node_id, node_result in result.results.items():
        print(f"\n=== {node_id} ===")
        print(str(node_result.result))

    return str(result)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Graph')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))
