from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import calculator, file_read, shell, current_time, http_request, editor, retrieve
import json
import os
import asyncio
import argparse

@tool
def research_agent_8004(user_input: str) -> str:
    """Research Agent - You are a research specialist. Gather relevant facts and background information for the given topic."""
    
    # Create model for Research Agent
    research_agent_8004_model = BedrockModel(
            model_id="global.anthropic.claude-sonnet-4-6",
            temperature=0.7,
            max_tokens=4000
        )

    # Create agent
    agent = Agent(
        model=research_agent_8004_model,
        system_prompt="""You are a research specialist. Gather relevant facts and background information for the given topic.""",
        callback_handler=None
    )

    # Execute and return result
    response = agent(user_input)
    return str(response)

@tool
def writer_agent_9004(user_input: str) -> str:
    """Writer Agent - You are a writing specialist. Turn provided facts into clear, well-structured prose."""
    
    # Create model for Writer Agent
    writer_agent_9004_model = BedrockModel(
            model_id="global.anthropic.claude-sonnet-4-6",
            temperature=0.7,
            max_tokens=4000
        )

    # Create agent
    agent = Agent(
        model=writer_agent_9004_model,
        system_prompt="""You are a writing specialist. Turn provided facts into clear, well-structured prose.""",
        callback_handler=None
    )

    # Execute and return result
    response = agent(user_input)
    return str(response)

# Coordinator Configuration
coordinator_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

coordinator = Agent(
    model=coordinator_model,
    system_prompt="""You are an orchestrator agent that coordinates specialized agents to complete complex tasks.

Coordination Instructions: Delegate research questions to the Research Agent tool and writing tasks to the Writer Agent tool, then combine their results into a final answer.""",
    tools=[research_agent_8004, writer_agent_9004],
    callback_handler=None
)

# Main execution
async def main(user_input_arg: str = None, messages_arg: str = None):
    # Access the global variables
    global coordinator
    # User input from command-line arguments with priority: --messages > --user-input > default
    if messages_arg is not None and messages_arg.strip():
        # Parse messages JSON and pass full conversation history to agent
        try:
            messages_list = json.loads(messages_arg)
            # Pass the full messages list to the agent
            user_input = messages_list
        except (json.JSONDecodeError, KeyError, TypeError):
            user_input = "Hello, how can you help me?"
    elif user_input_arg is not None and user_input_arg.strip():
        user_input = user_input_arg.strip()
    else:
        # Default fallback when no input provided
        user_input = "Hello, how can you help me?"
    # Execute agent (sync execution)
    response = coordinator(user_input)
    print(str(response))
    
    return str(response)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Execute Strands Agent')
    parser.add_argument('--user-input', type=str, help='User input prompt')
    parser.add_argument('--messages', type=str, help='JSON string of conversation messages')

    args = parser.parse_args()

    user_input_param = args.user_input
    messages_param = args.messages

    asyncio.run(main(user_input_param, messages_param))
