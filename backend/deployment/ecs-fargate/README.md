# ECS Fargate Deployment Service

AWS ECS Fargate deployment service for containerized Strands agents using CloudFormation.

## Overview

This service deploys Strands agents to AWS ECS Fargate using Infrastructure as Code (CloudFormation) for unified resource management.

## Files

- `ecs_deployment_service.py` - Main deployment service with CloudFormation integration
- `cloudformation-template.yaml` - Infrastructure template for ECS resources
- `Dockerfile` - Container image build template
- `agent_server.py` - HTTP server template for containerized agents
- `requirements.txt` - Python dependencies for containers

## Usage

### Basic Configuration

```python
from ecs_deployment_service import ECSDeploymentService, ECSDeploymentConfig

config = ECSDeploymentConfig(
    service_name="my-agent",
    cpu=256,
    memory=512,
    region="us-east-1"
)

service = ECSDeploymentService()
result = await service.deploy_agent(generated_code, config, deployment_id)
```

### Stack Management

```python
# Deploy creates CloudFormation stack: strands-agent-{service_name}
result = await service.deploy_agent(code, config)

# Delete removes all resources
await service.delete_stack(stack_name, region)
```

## Configuration Parameters

### Required
- `service_name`: ECS service name
- `cpu`: CPU units (256, 512, 1024, 2048, 4096)
- `memory`: Memory MB (matching CPU requirements)
- `region`: AWS region

### Optional
- `container_name`: Container name (default: "strands-agent")
- `container_port`: Container port (default: 8000)
- `desired_count`: Number of tasks (default: 1)
- `enable_load_balancer`: Create ALB (default: True)
- `enable_logging`: CloudWatch logs (default: True)
- `health_check_path`: Health endpoint (default: "/health")
- `vpc_id`: VPC ID (uses default if not specified)
- `subnet_ids`: Subnet IDs list
- `security_group_ids`: Security group IDs list
- `execution_role_arn`: ECS execution role ARN
- `task_role_arn`: ECS task role ARN

## Deployment Process

1. **Prerequisites validation** - Check Docker, AWS CLI
2. **Code analysis** - Detect streaming capabilities
3. **Docker image build** - Create and push to ECR
4. **CloudFormation deployment** - Create/update infrastructure
5. **Stack completion wait** - Monitor resource creation
6. **Output retrieval** - Get service endpoints

## Features

- **Infrastructure as Code**: All resources managed via CloudFormation
- **Streaming detection**: Automatic detection of async streaming code
- **Progress notifications**: Real-time WebSocket updates
- **Resource cleanup**: One-command stack deletion
- **Error handling**: Comprehensive error reporting and rollback

## API Endpoints

- `POST /api/deploy/ecs-fargate` - Deploy agent
- `DELETE /api/deploy/ecs-fargate/{stack_name}` - Remove deployment
- `POST /api/deploy/ecs/invoke` - Invoke deployed service
- `POST /api/deploy/ecs/invoke/stream` - Stream invoke deployed service

## Container Architecture

- **Base image**: `python:3.11-slim`
- **Runtime**: Strands Agent SDK + generated code
- **Server**: FastAPI HTTP server with health checks
- **Logging**: CloudWatch integration
- **Health checks**: HTTP GET `/health`

## Dependencies

- AWS CLI and Docker (for builds)
- boto3 (AWS SDK)
- CloudFormation (resource management)
- ECR (container registry)
- ECS Fargate (container orchestration)
- CloudWatch (logging and monitoring)