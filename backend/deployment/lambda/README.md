# AWS Lambda 部署实现

这个目录包含了将 Strands 代理部署到 AWS Lambda 的完整实现。

## 🏗️ 架构设计

### 两层服务架构

```
app/services/deployment_service.py        (编排层)
        ↓ 调用
deployment/lambda/lambda_deployment_service.py  (实现层)
        ↓ 使用
AWS SAM CLI → AWS CloudFormation → AWS Lambda
```

#### 编排层 (`app/services/deployment_service.py`)
- 处理 API 请求和响应格式
- 管理部署状态和生命周期
- 统一的错误处理和日志记录
- 多部署类型的路由分发

#### 实现层 (`lambda_deployment_service.py`)
- 具体的 SAM CLI 操作和流程控制
- Strands 代码注入到 Lambda 处理函数
- AWS 资源创建和配置管理
- 部署包构建和上传

### 核心文件说明

| 文件 | 作用 | 说明 |
|------|------|------|
| `template.yaml` | SAM 部署模板 | 定义 Lambda 函数、API Gateway 等 AWS 资源 |
| `agent_handler.py` | Lambda 处理函数模板 | Strands 代码将被注入到此模板中 |
| `lambda_deployment_service.py` | 核心部署逻辑 | 处理 SAM 构建、部署、代码注入等 |
| `requirements.txt` | Python 依赖 | Strands SDK 和相关依赖包 |
| `test_simple.py` | 简化测试脚本 | 测试最小化 Strands 代码的部署流程 |

## 🔄 部署流程详解

### 1. 请求处理流程
```
前端 → FastAPI → DeploymentService → LambdaDeploymentService → SAM CLI → AWS
```

### 2. 具体部署步骤

#### 步骤 1: 预处理
- 验证 SAM CLI 和 AWS CLI 可用性
- 检查 AWS 凭证和权限
- 创建临时构建目录

#### 步骤 2: 代码注入
- 读取 `agent_handler.py` 模板
- 将生成的 Strands 代码注入到模板中
- 替换占位符，生成完整的 Lambda 处理函数

#### 步骤 3: 构建部署包
- 复制 SAM 模板到临时目录
- 生成 `samconfig.toml` 配置文件
- 执行 `sam build` 构建部署包

#### 步骤 4: 部署到 AWS
- 执行 `sam deploy` 部署到 AWS
- 创建 CloudFormation 栈和相关资源
- 获取部署结果（函数 ARN、API 端点等）

#### 步骤 5: 结果返回
- 解析 CloudFormation 输出
- 格式化部署结果
- 返回状态和访问信息

### 3. 代码注入机制

**模板处理：**
```python
# agent_handler.py 中的占位符
# This is a placeholder - the actual generated code will be injected here

# 注入后变成：
# Generated Strands agent code
from strands import Agent
from strands.models import BedrockModel
# ... 用户的代理代码
# End of generated code
```

**注入逻辑：**
1. 提取生成代码中的 `main()` 函数和工具定义
2. 去除一层缩进，适配 Lambda 处理函数的缩进级别
3. 添加输入参数处理和返回值格式化
4. 保持导入语句和依赖关系

## 🧪 测试说明

### 运行简化测试
```bash
cd backend/deployment/lambda
uv run python test_simple.py
```

### 测试用的最小化代码
```python
from strands import Agent
from strands.models import BedrockModel
from strands_tools import current_time

# 简单的 Agent 配置
agent_model = BedrockModel(
    model_id="us.anthropic.claude-3-haiku-20240307-v1:0",
    temperature=0.7,
    max_tokens=1000
)

main_agent = Agent(
    model=agent_model,
    system_prompt="You are a helpful assistant.",
    tools=[current_time]
)

async def main(user_input_arg=None, input_data_arg=None):
    user_input = input_data_arg if input_data_arg else "Hello! What time is it?"
    response = main_agent(user_input)
    return str(response)
```

### 测试流程验证
1. **前置条件检查** - AWS CLI、SAM CLI、凭证
2. **部署配置** - 函数名、内存、超时等参数
3. **代码注入** - 将测试代码注入到 Lambda 模板
4. **SAM 构建** - 构建部署包和依赖
5. **AWS 部署** - 创建 Lambda 函数和相关资源
6. **结果验证** - 检查函数 ARN 和 API 端点

## 🔧 配置参数

### SAM 模板参数
```yaml
Parameters:
  FunctionName: StrandsAgentFunction    # Lambda 函数名
  MemorySize: 512                      # 内存大小 (128-10240MB)
  Timeout: 300                         # 超时时间 (3-900秒)
  Runtime: python3.11                  # Python 版本
  Architecture: x86_64                 # 处理器架构
```

### 部署配置选项
```python
LambdaDeploymentConfig(
    function_name="my-agent",           # 必需：函数名
    memory_size=512,                    # 可选：内存大小
    timeout=300,                        # 可选：超时时间
    runtime="python3.11",               # 可选：Python 版本
    architecture="x86_64",              # 可选：x86_64 或 arm64
    region="us-east-1",                 # 可选：AWS 区域
    stack_name=None,                    # 可选：CloudFormation 栈名
    api_keys=None                       # 可选：API 密钥字典
)
```

## 🛡️ 安全考虑

### API 密钥处理
- API 密钥通过环境变量传递到 Lambda
- 不在代码中硬编码敏感信息
- 支持 OpenAI、Anthropic 等 API 密钥

### IAM 权限
SAM 自动创建的 IAM 角色包含：
- `AWSLambdaBasicExecutionRole` - 基本执行权限
- CloudWatch 日志写入权限
- 如需要调用其他 AWS 服务，需要额外配置权限

### 网络安全
- Lambda 函数默认在 AWS 管理的 VPC 中运行
- 支持自定义 VPC 配置（通过 `vpc_config` 参数）
- API Gateway 提供 HTTPS 端点

## 🚀 性能优化

### 内存和超时建议
| 代理复杂度 | 内存 (MB) | 超时 (s) | 成本 | 启动时间 |
|------------|-----------|----------|------|----------|
| 简单代理 | 256-512 | 30-60 | 低 | 快 |
| 中等复杂度 | 512-1024 | 60-180 | 中 | 中等 |
| 复杂代理 + MCP | 1024-2048 | 180-300 | 高 | 较慢 |

### 架构选择
- **x86_64**: 更好的兼容性，更多可用的 Python 包
- **arm64**: 更好的性价比（最多节省 34% 成本）

### 冷启动优化
- 保持部署包尽可能小
- 避免在全局作用域进行复杂初始化
- 考虑使用 Provisioned Concurrency（高流量场景）

## 📊 成本估算

### Lambda 计费模式
- **请求次数**: $0.20 per 1M requests
- **计算时间**: 按内存分配和执行时间计费
- **API Gateway**: $3.50 per million API calls（如果启用）

### 示例成本（每月）
```
假设：512MB 内存，平均执行时间 2 秒，10,000 次调用/月

Lambda 成本:
- 请求费用: 10,000 * $0.0000002 = $0.002
- 计算费用: 10,000 * 2s * $0.0000083333 = $0.167
- 总计: ~$0.17/月

API Gateway 成本:
- 10,000 * $0.0000035 = $0.035

月总成本: ~$0.21
```

## 🔧 故障排除

### 常见问题

1. **"SAM build failed: Binary validation failed for python"**
   ```
   原因: SAM CLI 找不到匹配的 Python 版本
   解决方案:

   方法1: 使用 --use-container 参数
   修改 lambda_deployment_service.py 中的 sam build 命令:
   result = subprocess.run(["sam", "build", "--use-container"], ...)

   方法2: 安装匹配的 Python 版本
   # macOS with Homebrew
   brew install python@3.11

   方法3: 修改测试脚本使用当前 Python 版本
   测试脚本会自动检测并使用合适的运行时版本
   ```

2. **"Access Denied" 错误**
   ```
   原因: AWS 凭证或 IAM 权限不足
   解决: 检查 aws configure 和 IAM 策略
   ```

3. **"Function too large" 错误**
   ```
   原因: 部署包超过 250MB 限制
   解决: 减少依赖或使用容器镜像部署
   ```

4. **超时错误**
   ```
   原因: 代理执行时间超过配置的超时时间
   解决: 增加 timeout 参数或优化代理性能
   ```

### 调试方法
```bash
# 查看 CloudFormation 栈状态
aws cloudformation describe-stacks --stack-name your-stack-name

# 查看 Lambda 函数日志
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/your-function

# 直接调用函数测试
aws lambda invoke --function-name your-function --payload '{"test": "data"}' response.json
```

---

**架构优势：**
✅ 清晰的分层设计
✅ 自动化的 SAM 部署流程
✅ 安全的代码注入机制
✅ 完整的错误处理和日志
✅ 灵活的配置和扩展性