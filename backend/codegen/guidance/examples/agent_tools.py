from strands import Agent, tool
from strands.models import BedrockModel, CacheConfig
from strands_tools import calculator, file_read, shell, current_time, http_request, editor, retrieve
import json
import os
import asyncio
import argparse

@tool
def word_counter(text: str) -> str:
    """Count the number of words in the provided text."""
    word_count = len(text.split())
    return f"Word count: {word_count}"

# Math Agent Configuration
math_agent_model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-4-6",
    temperature=0.7,
    max_tokens=4000
)

math_agent = Agent(
    model=math_agent_model,
    system_prompt="""You are a math assistant. Use the calculator tool for arithmetic and the word_counter tool to count words when asked.""",
    tools=[calculator, word_counter],
    callback_handler=None
)

# Main execution
async def main(user_input_arg: str = None, messages_arg: str = None):
    # Access the global variables
    global math_agent
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
    response = math_agent(user_input)
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
