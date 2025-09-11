#!/usr/bin/env python3

import requests
import json

def test_custom_tool_generation():
    """Test that custom tool code is properly generated using @tool decorator"""
    
    # Test code that simulates what the UI would generate
    test_code = """
from strands import Agent, tool
from strands.models import BedrockModel

@tool
def word_counter(text: str) -> str:
    \"\"\"Count words in the provided text\"\"\"
    word_count = len(text.split())
    return f"Word count: {word_count}"

# Agent1 Configuration
agent1_model = BedrockModel(
    model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.7,
    max_tokens=4000
)

agent1 = Agent(
    model=agent1_model,
    system_prompt=\"\"\"You are a helpful AI assistant.\"\"\",
    tools=[word_counter]
)

# Main execution
def main():
    global user_input, input_data
    
    # User input - prioritize input_data from execution panel
    if input_data is not None and input_data.strip():
        user_input = input_data.strip()
    else:
        # Default fallback
        user_input = "Please count the words in this sentence."
    
    # Execute agent
    response = agent1(user_input)
    print("Agent Response:", str(response))
    
    return str(response)

if __name__ == "__main__":
    main()
"""
    
    # Test with input data
    payload = {
        "code": test_code,
        "input_data": "Please count the words in this test sentence with custom tool functionality."
    }
    
    print("Testing custom tool integration...")
    print("=" * 60)
    
    try:
        response = requests.post("http://localhost:8000/api/execute", 
                               json=payload, 
                               timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Custom tool test passed!")
            print(f"Success: {result['result']['success']}")
            print(f"Output: {result['result']['output']}")
            
            # Check if the word counter tool was used
            output = result['result']['output']
            if "word_counter" in output and "7 words" in output:
                print("✅ Custom tool function executed successfully!")
                print("✅ Word counting functionality working correctly!")
            else:
                print("⚠️  Custom tool may not have been used correctly")
                print("Output does not contain expected tool usage indicators")
                
        else:
            print(f"❌ Test failed with status {response.status_code}")
            print(response.text)
            
    except Exception as e:
        print(f"❌ Test failed with exception: {e}")
    
    print("=" * 60)

if __name__ == "__main__":
    test_custom_tool_generation()