# AgentCore IAM Role 设置指南

## 🎯 概述

本指南说明如何使用 `create_agentcore_role.sh` 脚本自动创建和管理 Amazon Bedrock AgentCore 所需的IAM Role和Policy。

## 📋 前提条件

### 1. AWS CLI 安装和配置

确保已安装并配置AWS CLI：

```bash
# 检查AWS CLI是否安装
aws --version

# 如果未安装，请安装AWS CLI
# macOS
brew install awscli

# Ubuntu/Debian
sudo apt-get install awscli

# 配置AWS凭证
aws configure
```

### 2. AWS权限要求

执行脚本的用户需要以下IAM权限：

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "sts:GetCallerIdentity",
                "iam:CreateRole",
                "iam:GetRole",
                "iam:CreatePolicy",
                "iam:GetPolicy",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:DeleteRole",
                "iam:DeletePolicy",
                "iam:ListAttachedRolePolicies"
            ],
            "Resource": "*"
        }
    ]
}
```

### 3. 支持的AWS区域

脚本支持以下4个区域：
- `us-east-1` (N. Virginia)
- `us-west-2` (Oregon)
- `eu-central-1` (Frankfurt)
- `ap-southeast-1` (Singapore)

## 🚀 快速开始

### 1. 进入backend目录

```bash
cd backend
```

### 2. 确保脚本可执行

```bash
chmod +x create_agentcore_role.sh
```

### 3. 创建AgentCore Role

```bash
# 基本用法 - 创建Role和Policy
./create_agentcore_role.sh create

# 或者直接运行（默认为create）
./create_agentcore_role.sh
```

## 📖 详细使用说明

### 命令语法

```bash
./create_agentcore_role.sh [命令] [选项]
```

### 可用命令

#### 1. `create` - 创建Role和Policy（默认）

```bash
# 基本创建
./create_agentcore_role.sh create

# 详细输出模式
AGENTCORE_VERBOSE=true ./create_agentcore_role.sh create

# 自定义Role名称
AGENTCORE_ROLE_NAME="MyCustomRole" ./create_agentcore_role.sh create
```

**执行流程：**
1. 检查AWS CLI和凭证
2. 自动获取当前AWS账户ID
3. 检查Role是否已存在
4. 如果不存在，创建新的Role和Policy
5. 如果存在但Policy未附加，自动修复

#### 2. `check` - 检查Role状态

```bash
# 检查Role和Policy状态
./create_agentcore_role.sh check
```

**输出示例：**
```
[INFO] 检查Role状态: AmazonBedrockAgentCoreRuntimeDefaultServiceRole
✅ Role存在: AmazonBedrockAgentCoreRuntimeDefaultServiceRole
✅ Policy正确附加: AmazonBedrockAgentCoreRuntimeDefaultPolicy
```

#### 3. `delete` - 删除Role和Policy

```bash
# 删除Role和Policy（谨慎使用）
./create_agentcore_role.sh delete
```

**⚠️ 警告：** 此操作会删除Role和Policy，请确保没有正在运行的AgentCore实例使用此Role。

#### 4. `help` - 显示帮助信息

```bash
./create_agentcore_role.sh help
# 或
./create_agentcore_role.sh --help
```

## ⚙️ 配置选项

### 环境变量

可以通过环境变量自定义脚本行为：

```bash
# 自定义Role名称（默认：AmazonBedrockAgentCoreRuntimeDefaultServiceRole）
export AGENTCORE_ROLE_NAME="MyCustomAgentCoreRole"

# 自定义Policy名称（默认：AmazonBedrockAgentCoreRuntimeDefaultPolicy）
export AGENTCORE_POLICY_NAME="MyCustomAgentCorePolicy"

# 启用详细输出（默认：false）
export AGENTCORE_VERBOSE=true

# 然后运行脚本
./create_agentcore_role.sh create
```

### 一次性设置

```bash
# 使用自定义名称创建Role
AGENTCORE_ROLE_NAME="ProductionAgentCore" \
AGENTCORE_POLICY_NAME="ProductionAgentCorePolicy" \
AGENTCORE_VERBOSE=true \
./create_agentcore_role.sh create
```

## 📊 输出说明

### 成功输出示例

```bash
$ ./create_agentcore_role.sh create

[INFO] 开始AgentCore IAM Role预检查...
[INFO] 检测到AWS账户ID: 123456789012
[INFO] Role AmazonBedrockAgentCoreRuntimeDefaultServiceRole 已存在
[SUCCESS] ✅ Role和Policy配置正确，无需操作
```

### 创建新Role输出示例

```bash
$ ./create_agentcore_role.sh create

[INFO] 开始AgentCore IAM Role预检查...
[INFO] 检测到AWS账户ID: 123456789012
[INFO] 创建IAM Role: AmazonBedrockAgentCoreRuntimeDefaultServiceRole
[SUCCESS] Role创建成功: AmazonBedrockAgentCoreRuntimeDefaultServiceRole
[INFO] 创建新Policy: AmazonBedrockAgentCoreRuntimeDefaultPolicy
[SUCCESS] Policy创建成功: arn:aws:iam::123456789012:policy/AmazonBedrockAgentCoreRuntimeDefaultPolicy
[INFO] 附加Policy到Role
[SUCCESS] Policy附加成功: arn:aws:iam::123456789012:policy/AmazonBedrockAgentCoreRuntimeDefaultPolicy -> AmazonBedrockAgentCoreRuntimeDefaultServiceRole
[SUCCESS] ✅ AgentCore IAM Role创建完成: AmazonBedrockAgentCoreRuntimeDefaultServiceRole
```

### 详细输出模式

```bash
$ AGENTCORE_VERBOSE=true ./create_agentcore_role.sh create

[DEBUG] Trust Policy: {"Version":"2012-10-17","Statement":[...]}
[DEBUG] Policy Document: {"Version":"2012-10-17","Statement":[...]}
# ... 更多调试信息
```

## 🔍 故障排除

### 常见错误及解决方案

#### 1. AWS CLI未安装或未配置

**错误：**
```
[ERROR] AWS CLI未安装，请先安装AWS CLI
```

**解决方案：**
```bash
# 安装AWS CLI
brew install awscli  # macOS
# 或
sudo apt-get install awscli  # Ubuntu

# 配置凭证
aws configure
```

#### 2. AWS凭证无效

**错误：**
```
[ERROR] AWS凭证未配置或无效，请运行 'aws configure'
```

**解决方案：**
```bash
# 重新配置AWS凭证
aws configure

# 或检查现有配置
aws sts get-caller-identity
```

#### 3. 权限不足

**错误：**
```
An error occurred (AccessDenied) when calling the CreateRole operation
```

**解决方案：**
- 确保当前用户有IAM创建权限
- 联系AWS管理员添加必要的IAM权限

#### 4. Role已存在但配置不正确

**输出：**
```
[WARNING] Policy未正确附加，尝试修复...
[SUCCESS] Policy修复完成
```

**说明：** 脚本会自动检测并修复Policy附加问题。

## 🔐 安全最佳实践

### 1. 权限最小化

创建的Role仅包含AgentCore运行所需的最小权限：
- ECR镜像访问
- CloudWatch Logs写入
- X-Ray追踪
- Bedrock模型调用

### 2. 区域限制

Policy仅支持指定的4个区域，防止跨区域权限滥用。

### 3. 账户隔离

Trust Policy限制仅允许当前账户的AgentCore服务假设此Role。

### 4. 定期审查

建议定期检查Role使用情况：

```bash
# 检查Role状态
./create_agentcore_role.sh check

# 查看Role详细信息
aws iam get-role --role-name AmazonBedrockAgentCoreRuntimeDefaultServiceRole
```

## 🔄 集成到部署流程

### 在部署前自动执行

```bash
#!/bin/bash
# deploy_agentcore.sh

echo "🔍 预检查IAM Role..."
./create_agentcore_role.sh create

if [ $? -eq 0 ]; then
    echo "✅ IAM Role准备就绪"
    echo "🚀 开始部署AgentCore..."
    # 继续部署流程
else
    echo "❌ IAM Role预检查失败，停止部署"
    exit 1
fi
```

### 在CI/CD中使用

```yaml
# .github/workflows/deploy.yml
- name: Setup AgentCore IAM Role
  run: |
    cd backend
    ./create_agentcore_role.sh create
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_DEFAULT_REGION: us-east-1
```

## 📝 使用场景

### 1. 首次设置

```bash
# 第一次部署AgentCore前
cd backend
./create_agentcore_role.sh create
```

### 2. 环境迁移

```bash
# 迁移到新的AWS账户
cd backend
./create_agentcore_role.sh create
```

### 3. 权限修复

```bash
# 修复Role配置问题
cd backend
./create_agentcore_role.sh create
```

### 4. 状态检查

```bash
# 定期检查Role状态
cd backend
./create_agentcore_role.sh check
```

## 📞 支持

如果遇到问题：

1. **检查日志输出**：使用 `AGENTCORE_VERBOSE=true` 获取详细信息
2. **验证权限**：确保有足够的IAM权限
3. **检查区域**：确保在支持的区域内操作
4. **查看文档**：参考 `IAM_ROLE_PRECHECK.md` 了解技术细节

---

**🎉 现在您可以轻松管理AgentCore所需的IAM Role了！**
