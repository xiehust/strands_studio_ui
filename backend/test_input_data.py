#!/usr/bin/env python3

import requests
import json

# Test the input_data functionality
def test_input_data():
    # Simple test code that uses input_data
    test_code = """
from strands import Agent, tool
from strands.models import BedrockModel

# User input - prioritize input_data from execution panel
if input_data is not None and input_data.strip():
    user_input = input_data.strip()
else:
    # Default fallback
    user_input = "Hello, how can you help me?"

def main():
    global user_input, input_data
    print(f"Received input: '{user_input}'")
    print(f"Input data variable: {repr(input_data)}")
    return f"Processed: {user_input}"
"""
    
    # Test with input data
    payload = {
        "code": test_code,
        "input_data": "This is test input from the execution panel!"
    }
    
    print("Testing with input data...")
    response = requests.post("http://localhost:8000/api/execute", json=payload)
    
    if response.status_code == 200:
        result = response.json()
        print("✅ Test passed!")
        print(f"Success: {result['result']['success']}")
        print(f"Output: {result['result']['output']}")
        
        # Check if input_data was used
        if "This is test input from the execution panel!" in result['result']['output']:
            print("✅ Input data was correctly used!")
        else:
            print("❌ Input data was not used correctly")
    else:
        print(f"❌ Test failed with status {response.status_code}")
        print(response.text)
    
    print("\n" + "="*50 + "\n")
    
    # Test without input data
    payload_no_input = {
        "code": test_code
        # No input_data provided
    }
    
    print("Testing without input data...")
    response = requests.post("http://localhost:8000/api/execute", json=payload_no_input)
    
    if response.status_code == 200:
        result = response.json()
        print("✅ Test passed!")
        print(f"Success: {result['result']['success']}")
        print(f"Output: {result['result']['output']}")
        
        # Check if fallback was used
        if "Hello, how can you help me?" in result['result']['output']:
            print("✅ Fallback input was correctly used!")
        else:
            print("❌ Fallback input was not used correctly")
    else:
        print(f"❌ Test failed with status {response.status_code}")
        print(response.text)

if __name__ == "__main__":
    test_input_data()