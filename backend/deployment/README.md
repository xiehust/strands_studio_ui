# Strands Agent 部署系统

将拖拽生成的 Strands 代理代码一键部署到多种云平台的后端系统。

## 📋 项目状态

| 部署类型 | 状态 | 描述 | 适用场景 | 负责人 | 优先级 |
|---------|------|------|----------|--------|--------|
| **AWS Lambda** | ✅ 可用 | 无服务器函数部署 | 轻量级代理，按需执行 | - | P0 |
| **AgentCore** | 🔄 开发中 | 企业级代理管理平台 | 企业环境，团队协作 | TBD | P1 |
| **ECS Fargate** | 📋 计划中 | 容器化部署 | 长期运行，高吞吐量 | TBD | P2 |

---

## 📖 用户使用指南

### 🚀 快速开始

#### 1. 检查系统状态
```bash
# 健康检查
curl -X GET http://localhost:8000/api/deploy/health

# 获取可用部署类型
curl -X GET http://localhost:8000/api/deploy/types
```

#### 2. Lambda 部署示例
```bash
curl -X POST http://localhost:8000/api/deploy/ \
  -H "Content-Type: application/json" \
  -d '{
    "deployment_type": "lambda",
    "code": "from strands import Agent\n# 你的代理代码",
    "function_name": "my-strands-agent",
    "memory_size": 512,
    "timeout": 300
  }'
```

#### 3. 查看部署状态
```bash
# 检查特定部署状态
curl -X GET http://localhost:8000/api/deploy/status/{deployment_id}

# 列出所有部署
curl -X GET http://localhost:8000/api/deploy/list
```

### 🔧 API 接口

#### 通用部署接口
```http
POST /api/deploy/
Content-Type: application/json

{
    "deployment_type": "lambda|agentcore|ecs-fargate",
    "code": "生成的 Strands 代码",
    // 特定类型的配置参数
}
```

#### 专用接口（向后兼容）
- `POST /api/deploy/lambda` - Lambda 专用接口 ✅
- `POST /api/deploy/agentcore` - AgentCore 专用接口 🔄
- `POST /api/deploy/ecs-fargate` - ECS 专用接口 📋

#### 管理接口
- `GET /api/deploy/status/{deployment_id}` - 获取部署状态
- `GET /api/deploy/list` - 列出所有部署
- `GET /api/deploy/health` - 健康检查
- `GET /api/deploy/types` - 获取支持的部署类型
- `DELETE /api/deploy/{deployment_id}` - 删除部署记录
- `DELETE /api/deploy/cleanup` - 清理旧部署记录

### 📊 部署类型详解

#### AWS Lambda 部署 ✅

**优势：**
- 🚀 快速部署（1-3 分钟）
- 💰 按需计费，无服务器管理
- 🔄 自动扩展
- 🛡️ 内置安全性和监控

**配置参数：**
```json
{
    "deployment_type": "lambda",
    "function_name": "Lambda 函数名（必需）",
    "memory_size": 512,           // 内存大小 (128-10240MB)
    "timeout": 300,               // 超时时间 (3-900秒)
    "runtime": "python3.11",      // Python 版本
    "architecture": "x86_64",     // x86_64 或 arm64
    "region": "us-east-1",        // AWS 区域
    "enable_api_gateway": true,   // 创建 API Gateway
    "vpc_config": null            // VPC 配置
}
```

**前置条件：**
- ✅ AWS CLI 已安装和配置
- ✅ SAM CLI 已安装
- ✅ 有效的 AWS 凭证
- ✅ 必要的 IAM 权限

#### AgentCore 部署 🔄

**优势：**
- 🏢 企业级代理管理
- 📊 内置监控和分析
- 🔄 版本管理和回滚
- 👥 团队协作功能

**配置参数（计划中）：**
```json
{
    "deployment_type": "agentcore",
    "agent_name": "代理名称（必需）",
    "namespace": "命名空间",
    "replicas": 2,                // 副本数量
    "agentcore_endpoint": "AgentCore 端点（必需）",
    "agentcore_token": "认证令牌"
}
```

#### ECS Fargate 部署 📋

**优势：**
- 🐳 容器化部署
- 🔄 持续运行
- 📈 可预测的性能
- 🌐 负载均衡器集成

**配置参数（计划中）：**
```json
{
    "deployment_type": "ecs-fargate",
    "cluster_name": "ECS 集群名（必需）",
    "service_name": "服务名（必需）",
    "task_definition_family": "任务定义族（必需）",
    "cpu": 512,                   // CPU 单位
    "memory": 1024,               // 内存大小
    "subnet_ids": ["subnet-123"], // 子网 ID 列表（必需）
    "security_group_ids": ["sg-789"] // 安全组 ID 列表（必需）
}
```

### 📋 响应格式

#### 部署响应
```json
{
    "success": true,
    "deployment_id": "uuid-string",
    "message": "部署状态消息",
    "deployment_type": "lambda|agentcore|ecs-fargate",
    "status": {
        "deployment_id": "uuid-string",
        "deployment_type": "lambda",
        "status": "pending|building|deploying|completed|failed",
        "message": "详细状态信息",
        "endpoint_url": "https://api-endpoint.com",
        "resource_arn": "arn:aws:lambda:...",
        "logs": ["部署日志..."],
        "created_at": "2024-01-01T00:00:00Z",
        "completed_at": "2024-01-01T00:05:00Z",
        "deployment_time": 300.5,
        "deployment_outputs": {
            "function_name": "my-agent",
            "region": "us-east-1"
        }
    }
}
```

### 🧪 测试和验证

```bash
# 测试 Lambda 部署（需要 AWS 凭证）
cd backend/deployment/lambda
uv run python test_simple.py

# 验证部署模型
uv run python -c "from app.models.deployment import *; print('✅ 模型加载成功')"

# 验证 API 路由
uv run python -c "from app.routers.deployment import router; print('✅ 路由加载成功')"
```

### 🔧 故障排除

1. **"部署路由未启用"** - 检查依赖安装和启动日志
2. **"SAM CLI 未找到"** - 安装 AWS SAM CLI 并确保在 PATH 中
3. **"部署类型不支持"** - 检查 `deployment_type` 字段和模型类
4. **"权限不足"** - 检查 AWS 凭证和 IAM 权限

---

## 🛠️ 开发者指南

### 🏗️ 系统架构

#### 目录结构
```
backend/
├── deployment/
│   ├── lambda/                     # ✅ AWS Lambda 实现
│   │   ├── template.yaml           # SAM 部署模板
│   │   ├── agent_handler.py        # Lambda 处理函数模板
│   │   ├── lambda_deployment_service.py # Lambda 部署逻辑
│   │   ├── requirements.txt        # 依赖列表
│   │   └── README.md              # Lambda 使用文档
│   ├── agentcore/                  # 🔄 AgentCore 实现（待开发）
│   │   └── README.md              # AgentCore 规范文档
│   ├── ecs-fargate/               # 🔄 ECS Fargate 实现（待开发）
│   │   └── README.md              # ECS Fargate 规范文档
│   └── README.md                  # 本文档
├── app/
│   ├── models/deployment.py        # ✅ 数据模型定义
│   ├── services/deployment_service.py # ✅ 部署服务编排
│   └── routers/deployment.py       # ✅ API 路由定义
└── main.py                        # ✅ 主应用（包含可选部署路由）
```

#### 核心组件设计

**1. 数据模型层** (`app/models/deployment.py`)
```python
# 基础模型
class BaseDeploymentRequest(BaseModel):
    code: str                       # 生成的 Strands 代码
    project_id: Optional[str]       # 项目 ID
    version: Optional[str]          # 版本号
    api_keys: Optional[Dict[str, str]]  # API 密钥

# Lambda 实现 ✅
class LambdaDeploymentRequest(BaseDeploymentRequest):
    deployment_type: Literal["lambda"] = "lambda"
    function_name: str
    memory_size: int = 512
    # ... 其他 Lambda 特定参数

# AgentCore 待实现 🔄
class AgentCoreDeploymentRequest(BaseDeploymentRequest):
    deployment_type: Literal["agentcore"] = "agentcore"
    # TODO: 根据 AgentCore API 规范添加字段

# ECS Fargate 待实现 🔄
class ECSFargateDeploymentRequest(BaseDeploymentRequest):
    deployment_type: Literal["ecs-fargate"] = "ecs-fargate"
    # TODO: 根据 ECS 需求添加字段
```

**2. 服务层** (`app/services/deployment_service.py`)
```python
class DeploymentService:
    async def deploy(self, request: DeploymentRequest) -> DeploymentResponse:
        """统一部署入口 - 根据类型分发到具体实现"""

    async def deploy_to_lambda(self, request) -> DeploymentResponse:
        """✅ Lambda 部署实现"""

    async def deploy_to_agentcore(self, request) -> DeploymentResponse:
        """🔄 AgentCore 部署实现（待开发）"""

    async def deploy_to_ecs_fargate(self, request) -> DeploymentResponse:
        """🔄 ECS Fargate 部署实现（待开发）"""
```

### 🔧 添加新部署类型

#### 步骤 1: 定义数据模型
在 `app/models/deployment.py` 中：
```python
class YourDeploymentRequest(BaseDeploymentRequest):
    deployment_type: Literal["your-type"] = "your-type"

    # 添加特定字段
    your_field: str = Field(..., description="字段说明")
    optional_field: Optional[int] = Field(None, description="可选字段")

# 更新 Union 类型
DeploymentRequest = Union[
    LambdaDeploymentRequest,
    AgentCoreDeploymentRequest,
    ECSFargateDeploymentRequest,
    YourDeploymentRequest  # 添加新类型
]
```

#### 步骤 2: 实现部署服务
在 `app/services/deployment_service.py` 中：
```python
async def deploy_to_your_type(self, request: YourDeploymentRequest) -> DeploymentResponse:
    """实现具体的部署逻辑"""
    deployment_id = str(uuid.uuid4())

    # 创建初始状态
    status = DeploymentStatus(
        deployment_id=deployment_id,
        deployment_type=DeploymentType.YOUR_TYPE,
        status="pending",
        message="开始部署",
        created_at=datetime.now().isoformat()
    )

    try:
        # 实现部署逻辑
        # ...

        # 更新成功状态
        status.status = "completed"
        status.endpoint_url = "your-endpoint"

    except Exception as e:
        # 处理错误
        status.status = "failed"
        status.message = str(e)

    return DeploymentResponse(...)
```

#### 步骤 3: 添加 API 路由
在 `app/routers/deployment.py` 中：
```python
@router.post("/your-type", response_model=DeploymentResponse)
async def deploy_to_your_type(request: YourDeploymentRequest):
    """部署到你的目标平台"""
    try:
        result = await deployment_service.deploy_to_your_type(request)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

#### 步骤 4: 创建实现目录
```bash
mkdir deployment/your-type/
```

在该目录下创建：
- `your_deployment_service.py` - 核心部署逻辑
- `requirements.txt` - 依赖列表
- `README.md` - 使用文档
- 其他必要的配置文件

### 📝 代码规范

#### 命名约定
- 类名：`PascalCase`（如 `LambdaDeploymentRequest`）
- 方法名：`snake_case`（如 `deploy_to_lambda`）
- 字段名：`snake_case`（如 `function_name`）
- 枚举值：`UPPER_CASE`（如 `DeploymentType.LAMBDA`）

#### 错误处理
```python
try:
    # 部署逻辑
    result = await some_deployment_operation()
except SpecificError as e:
    logger.error(f"特定错误: {e}")
    return DeploymentResponse(success=False, message=f"部署失败: {e}")
except Exception as e:
    logger.error(f"未知错误: {e}", exc_info=True)
    return DeploymentResponse(success=False, message="部署过程中发生未知错误")
```

#### 日志记录
```python
logger.info(f"开始 {deployment_type} 部署: {deployment_id}")
logger.debug(f"部署参数: {request.dict()}")
logger.error(f"部署失败: {error_message}")
```

### 🧪 测试指南

#### 单元测试结构
```python
# tests/test_your_deployment.py
import pytest
from app.models.deployment import YourDeploymentRequest
from app.services.deployment_service import DeploymentService

class TestYourDeployment:
    async def test_deploy_success(self):
        request = YourDeploymentRequest(
            code="test code",
            your_field="test value"
        )

        service = DeploymentService()
        result = await service.deploy_to_your_type(request)

        assert result.success == True
        assert result.deployment_type == DeploymentType.YOUR_TYPE
```


### 常用命令
```bash
# 测试部署模型
uv run python -c "from app.models.deployment import *; print('✅ 模型加载成功')"

# 测试 API 路由
uv run python -c "from app.routers.deployment import router; print('✅ 路由加载成功')"

# 运行健康检查
curl http://localhost:8000/api/deploy/health

# 查看支持的部署类型
curl http://localhost:8000/api/deploy/types
```
