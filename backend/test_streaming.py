#!/usr/bin/env python3

import requests
import json

def test_streaming():
    print("Testing streaming functionality...")
    
    # Test code with streaming enabled
    test_code = '''
from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import calculator, file_read, shell, current_time
import json

# Test Agent Configuration
test_agent_model = BedrockModel(
    model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.7,
    max_tokens=4000
)

test_agent = Agent(
    model=test_agent_model,
    system_prompt="""You are a helpful assistant.""",
    tools=[calculator]
)

# Main execution
def main():
    # Access the global agent variable
    global test_agent
    
    # User input
    user_input = "What is 25 * 4?"
    
    # Execute agent
    response = test_agent(user_input)
    print("Agent Response:", str(response))
    
    return str(response)

if __name__ == "__main__":
    main()
'''

    try:
        print("=== Testing streaming endpoint ===")
        response = requests.post(
            "http://localhost:8000/api/execute/stream",
            json={"code": test_code},
            stream=True
        )
        
        if response.status_code == 200:
            print("✅ Streaming endpoint is accessible")
            print("Streaming output:")
            
            for line in response.iter_lines(decode_unicode=True):
                if line and line.startswith('data: '):
                    chunk = line[6:]  # Remove 'data: ' prefix
                    if chunk == '[STREAM_COMPLETE]':
                        print("\n✅ Stream completed successfully!")
                        break
                    elif chunk.startswith('Error: '):
                        print(f"\n❌ Stream error: {chunk[7:]}")
                        break
                    else:
                        print(chunk, end='', flush=True)
        else:
            print(f"❌ FAILURE: Status {response.status_code}")
            print("Response:", response.text)
            
    except Exception as e:
        print(f"❌ ERROR: {e}")

if __name__ == "__main__":
    test_streaming()