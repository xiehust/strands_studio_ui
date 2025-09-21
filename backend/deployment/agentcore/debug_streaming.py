"""Debug streaming code generation"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from deployment.agentcore.agentcore_deployment_service import AgentCoreDeploymentService

# Test streaming agent code
TEST_STREAMING_CODE = '''
from strands import Agent
from strands.models import BedrockModel
from strands_tools import current_time

main_agent = Agent(
    model=BedrockModel(
        model_id="us.anthropic.claude-3-haiku-20240307-v1:0",
        temperature=0.7,
        max_tokens=1000
    ),
    system_prompt="You are a helpful assistant for integration testing.",
    tools=[current_time],
    callback_handler=None
)

async def main():
    user_input = "Hello! What time is it?"
    async for chunk in main_agent.stream_async(user_input):
        yield str(chunk)
'''

async def main():
    service = AgentCoreDeploymentService()
    
    print("=== Original Code ===")
    print(TEST_STREAMING_CODE)
    
    print("\n=== Generated Runtime Handler ===")
    runtime_content = await service._generate_runtime_handler(TEST_STREAMING_CODE)
    print(runtime_content)
    
    print("\n=== Checking for syntax errors ===")
    try:
        compile(runtime_content, '<test>', 'exec')
        print("✅ Code compiles successfully")
    except SyntaxError as e:
        print(f"❌ Syntax error: {e}")
        print(f"Line {e.lineno}: {e.text}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
