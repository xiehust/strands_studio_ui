# ECS Fargate 部署实现

> 📋 **状态：计划中**

这个目录将包含 AWS ECS Fargate 容器化部署的实现。

## 📋 待实现功能

### 核心组件
- [ ] `ecs_deployment_service.py` - ECS Fargate 部署服务
- [ ] `Dockerfile` - 容器镜像构建文件
- [ ] `task_definition_template.json` - ECS 任务定义模板
- [ ] `service_template.json` - ECS 服务模板
- [ ] `requirements.txt` - 依赖包列表

### 数据模型（需要完善）
在 `app/models/deployment.py` 中的 `ECSFargateDeploymentRequest` 需要添加以下字段：

```python
class ECSFargateDeploymentRequest(BaseDeploymentRequest):
    deployment_type: Literal["ecs-fargate"] = "ecs-fargate"

    # 基础配置
    cluster_name: str = Field(..., description="ECS 集群名称")
    service_name: str = Field(..., description="服务名称")
    task_definition_family: str = Field(..., description="任务定义族名")

    # 容器配置
    container_name: str = Field("strands-agent", description="容器名称")
    container_port: int = Field(8000, description="容器端口")
    cpu: int = Field(256, description="CPU 单位 (256, 512, 1024, 2048, 4096)")
    memory: int = Field(512, description="内存 MB (512, 1024, 2048, ...)")

    # 网络配置
    subnet_ids: List[str] = Field(..., description="子网 ID 列表")
    security_group_ids: List[str] = Field(..., description="安全组 ID 列表")
    assign_public_ip: bool = Field(False, description="分配公网 IP")

    # 服务配置
    desired_count: int = Field(1, ge=1, le=100, description="期望任务数量")
    enable_logging: bool = Field(True, description="启用 CloudWatch 日志")

    # 负载均衡器配置
    target_group_arn: Optional[str] = Field(None, description="目标组 ARN")
    health_check_path: str = Field("/health", description="健康检查路径")

    # 自动扩展配置
    enable_autoscaling: bool = Field(False, description="启用自动扩展")
    min_capacity: int = Field(1, description="最小容量")
    max_capacity: int = Field(10, description="最大容量")
    target_cpu_utilization: int = Field(70, description="目标 CPU 使用率")

    # AWS 配置
    region: str = Field("us-east-1", description="AWS 区域")
    execution_role_arn: Optional[str] = Field(None, description="执行角色 ARN")
    task_role_arn: Optional[str] = Field(None, description="任务角色 ARN")
```

## 🔧 技术规范

### 容器化要求
- **基础镜像**：`python:3.11-slim`
- **运行时**：Strands Agent SDK + 生成的代码
- **端口暴露**：8000（可配置）
- **健康检查**：HTTP GET /health
- **优雅关闭**：支持 SIGTERM 信号

### 部署流程
1. **构建镜像** - 将 Strands 代码打包到 Docker 镜像
2. **推送 ECR** - 上传镜像到 Amazon ECR
3. **创建任务定义** - 定义容器规格和配置
4. **创建/更新服务** - 在 ECS 集群中部署服务
5. **配置负载均衡** - 设置 ALB/NLB（如果需要）
6. **设置自动扩展** - 配置基于 CPU/内存的自动扩展
7. **验证部署** - 检查服务状态和健康检查

### Dockerfile 模板
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制生成的代码
COPY generated_agent.py .
COPY agent_server.py .

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动服务
CMD ["python", "agent_server.py"]
```

### ECS 任务定义模板
```json
{
    "family": "${task_definition_family}",
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "${cpu}",
    "memory": "${memory}",
    "executionRoleArn": "${execution_role_arn}",
    "taskRoleArn": "${task_role_arn}",
    "containerDefinitions": [
        {
            "name": "${container_name}",
            "image": "${image_uri}",
            "portMappings": [
                {
                    "containerPort": ${container_port},
                    "protocol": "tcp"
                }
            ],
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "/ecs/${task_definition_family}",
                    "awslogs-region": "${region}",
                    "awslogs-stream-prefix": "ecs"
                }
            },
            "environment": [],
            "healthCheck": {
                "command": [
                    "CMD-SHELL",
                    "curl -f http://localhost:${container_port}/health || exit 1"
                ],
                "interval": 30,
                "timeout": 5,
                "retries": 3,
                "startPeriod": 60
            }
        }
    ]
}
```

## 🚀 优势特点

### 相比 Lambda 的优势
- **长期运行**：适合需要保持状态的代理
- **更大资源**：支持更高的 CPU 和内存配置
- **网络访问**：更灵活的网络配置
- **持久连接**：支持 WebSocket 等长连接

### 相比自建服务器的优势
- **无需管理服务器**：Fargate 全托管
- **按需扩展**：自动伸缩
- **高可用性**：多 AZ 部署
- **集成监控**：CloudWatch 日志和指标

## 📚 开发参考

### 实现步骤
1. 设计容器化架构
2. 实现 Docker 镜像构建
3. 完善数据模型字段
4. 实现 ECS 部署服务
5. 集成 ECR 镜像管理
6. 添加负载均衡器支持
7. 实现自动扩展配置
8. 编写端到端测试

### 技术依赖
- **AWS CLI** - 用于 AWS 资源管理
- **Docker** - 用于容器镜像构建
- **boto3** - AWS Python SDK
- **ECR** - 容器镜像仓库
- **ECS** - 容器编排服务
- **CloudWatch** - 日志和监控

### 成本考虑
- **计算成本**：按 vCPU 和内存使用时间计费
- **网络成本**：数据传输费用
- **存储成本**：ECR 镜像存储
- **监控成本**：CloudWatch 日志和指标

---

**分配给**：待分配
**预计工作量**：3-4 周
**依赖**：Docker 环境和 AWS ECS 权限