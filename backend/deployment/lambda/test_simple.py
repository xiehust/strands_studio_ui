#!/usr/bin/env python3
"""
简化的 Lambda 部署测试
测试最小化的 Strands 代码部署流程
"""
import asyncio
import logging

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 最小化的测试代码
MINIMAL_STRANDS_CODE = '''
from strands import Agent
from strands.models import BedrockModel
from strands_tools import current_time
import asyncio

# 简单的 Agent 配置
agent_model = BedrockModel(
    model_id="us.anthropic.claude-3-haiku-20240307-v1:0",
    temperature=0.7,
    max_tokens=1000
)

main_agent = Agent(
    model=agent_model,
    system_prompt="You are a helpful assistant. Keep responses short and friendly.",
    tools=[current_time]
)

async def main(user_input_arg=None, input_data_arg=None):
    """Main execution function for Lambda"""
    # 使用输入参数或默认消息
    user_input = input_data_arg if input_data_arg else "Hello! What time is it?"

    print(f"Processing: {user_input}")

    # 执行 agent
    response = main_agent(user_input)
    print(f"Agent response: {response}")

    return str(response)

if __name__ == "__main__":
    asyncio.run(main())
'''

async def test_lambda_deployment():
    """测试 Lambda 部署的完整流程"""
    print("🚀 开始 Lambda 部署测试")
    print("=" * 50)

    try:
        # 导入部署服务
        from lambda_deployment_service import LambdaDeploymentService, LambdaDeploymentConfig

        # 检测系统 Python 版本并使用兼容的运行时
        import sys
        python_version = f"{sys.version_info.major}.{sys.version_info.minor}"

        # 选择最接近的支持的 Lambda 运行时
        if python_version == "3.12":
            runtime = "python3.12"
        elif python_version == "3.11":
            runtime = "python3.11"
        elif python_version == "3.10":
            runtime = "python3.10"
        else:
            runtime = "python3.11"  # 默认值
            print(f"⚠️  当前 Python 版本 {python_version} 可能不兼容，使用默认运行时 {runtime}")

        # 创建部署配置
        config = LambdaDeploymentConfig(
            function_name="test-strands-minimal",
            memory_size=512,
            timeout=60,
            runtime=runtime,
            architecture="x86_64",
            region="us-east-1"
        )

        print(f"📋 部署配置:")
        print(f"  检测到的 Python 版本: {python_version}")
        print(f"  选择的运行时: {runtime}")
        print(f"  函数名: {config.function_name}")
        print(f"  内存: {config.memory_size}MB")
        print(f"  超时: {config.timeout}s")
        print(f"  运行时: {config.runtime}")
        print(f"  架构: {config.architecture}")
        print(f"  区域: {config.region}")
        print()

        # 初始化部署服务
        service = LambdaDeploymentService()

        print("🔧 开始部署...")
        # 执行部署
        result = await service.deploy_agent(MINIMAL_STRANDS_CODE, config)

        # 显示结果
        if result.success:
            print("✅ 部署成功!")
            print(f"📋 消息: {result.message}")

            if result.function_arn:
                print(f"🔗 函数 ARN: {result.function_arn}")

            if result.api_endpoint:
                print(f"🌐 API 端点: {result.api_endpoint}")

            if result.deployment_time:
                print(f"⏱️  部署耗时: {result.deployment_time:.2f}s")

            print("\n📖 测试调用示例:")
            print("aws lambda invoke \\")
            print(f"  --function-name {config.function_name} \\")
            print(f"  --region {config.region} \\")
            print("  --cli-binary-format raw-in-base64-out \\")
            print("  --payload '{\"prompt\": \"Hello, what time is it?\"}' \\")
            print("  response.json")
            print("\ncat response.json")

        else:
            print("❌ 部署失败!")
            print(f"📋 错误消息: {result.message}")

        # 显示部署日志
        if result.logs:
            print(f"\n📋 部署日志:")
            for i, log_line in enumerate(result.logs[-10:], 1):  # 只显示最后10行
                print(f"  {i:2d}. {log_line}")

        return result.success

    except ImportError as e:
        print(f"❌ 导入错误: {e}")
        print("💡 请确保在 backend/deployment/lambda 目录下运行此脚本")
        return False
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def print_prerequisites():
    """显示前置条件检查"""
    print("📋 前置条件检查:")

    import subprocess
    import sys

    # 检查 Python 版本
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}"
    supported_versions = ["3.9", "3.10", "3.11", "3.12"]

    if python_version in supported_versions:
        print(f"  ✅ Python 版本: {python_version} (支持)")
    else:
        print(f"  ⚠️  Python 版本: {python_version} (可能不支持)")

    # 检查 AWS CLI
    try:
        result = subprocess.run(["aws", "--version"], capture_output=True, text=True, check=True)
        print(f"  ✅ AWS CLI: {result.stdout.strip()}")
    except:
        print("  ❌ AWS CLI: 未安装或未配置")

    # 检查 SAM CLI
    try:
        result = subprocess.run(["sam", "--version"], capture_output=True, text=True, check=True)
        print(f"  ✅ SAM CLI: {result.stdout.strip()}")
    except:
        print("  ❌ SAM CLI: 未安装")

    # 检查 Docker（SAM 构建可能需要）
    try:
        result = subprocess.run(["docker", "--version"], capture_output=True, text=True, check=True)
        print(f"  ✅ Docker: {result.stdout.strip()}")
    except:
        print("  ⚠️  Docker: 未安装（可选，但推荐用于容器构建）")

    # 检查 AWS 凭证
    try:
        result = subprocess.run(["aws", "sts", "get-caller-identity"], capture_output=True, text=True, check=True)
        import json
        identity = json.loads(result.stdout)
        print(f"  ✅ AWS 凭证: {identity.get('Arn', 'OK')}")
    except:
        print("  ❌ AWS 凭证: 未配置")

    print()

if __name__ == "__main__":
    print("🧪 Lambda 部署简化测试")
    print("=" * 50)
    print()

    print_prerequisites()

    # 询问是否继续
    confirm = input("是否继续部署测试? (需要有效的 AWS 凭证) [y/N]: ")
    if confirm.lower() != 'y':
        print("测试取消")
        exit(0)

    # 运行测试
    success = asyncio.run(test_lambda_deployment())

    if success:
        print("\n🎉 测试完成! Lambda 部署功能正常工作")
    else:
        print("\n⚠️  测试失败，请检查上面的错误信息")