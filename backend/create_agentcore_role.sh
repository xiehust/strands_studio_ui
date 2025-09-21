#!/bin/bash

# AgentCore IAM Role 预检查和创建脚本
# 支持多区域部署，自动检测账户ID
# 
# 使用方法:
#   ./create_agentcore_role.sh [create|check|delete]
#
# 环境变量:
#   AGENTCORE_ROLE_NAME - 自定义Role名称
#   AGENTCORE_POLICY_NAME - 自定义Policy名称
#   AGENTCORE_VERBOSE - 启用详细输出

set -e  # 遇到错误立即退出

# 默认配置
DEFAULT_ROLE_NAME="AmazonBedrockAgentCoreRuntimeDefaultServiceRole"
DEFAULT_POLICY_NAME="AmazonBedrockAgentCoreRuntimeDefaultPolicy"
SUPPORTED_REGIONS=("us-east-1" "us-west-2" "eu-central-1" "ap-southeast-1")

# 从环境变量或使用默认值
ROLE_NAME="${AGENTCORE_ROLE_NAME:-$DEFAULT_ROLE_NAME}"
POLICY_NAME="${AGENTCORE_POLICY_NAME:-$DEFAULT_POLICY_NAME}"
VERBOSE="${AGENTCORE_VERBOSE:-false}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    if [ "$VERBOSE" = "true" ]; then
        echo -e "${BLUE}[DEBUG]${NC} $1"
    fi
}

# 检查AWS CLI是否安装
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI未安装，请先安装AWS CLI"
        exit 1
    fi
    
    # 检查AWS凭证
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS凭证未配置或无效，请运行 'aws configure'"
        exit 1
    fi
}

# 获取账户ID
get_account_id() {
    aws sts get-caller-identity --query Account --output text
}

# 检查Role是否存在
check_role_exists() {
    aws iam get-role --role-name "$ROLE_NAME" &> /dev/null
    return $?
}

# 检查Policy是否已附加
check_policy_attached() {
    local account_id=$1
    local policy_arn="arn:aws:iam::${account_id}:policy/${POLICY_NAME}"
    
    aws iam list-attached-role-policies --role-name "$ROLE_NAME" \
        --query "AttachedPolicies[?PolicyArn=='$policy_arn'].PolicyArn" \
        --output text | grep -q "$policy_arn"
    return $?
}

# 生成Trust Policy JSON
generate_trust_policy() {
    local account_id=$1
    local source_arns=""
    
    # 构建所有支持区域的ARN列表
    for region in "${SUPPORTED_REGIONS[@]}"; do
        if [ -n "$source_arns" ]; then
            source_arns="$source_arns,"
        fi
        source_arns="$source_arns\"arn:aws:bedrock-agentcore:$region:$account_id:*\""
    done
    
    cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AssumeRolePolicy",
            "Effect": "Allow",
            "Principal": {
                "Service": "bedrock-agentcore.amazonaws.com"
            },
            "Action": "sts:AssumeRole",
            "Condition": {
                "StringEquals": {
                    "aws:SourceAccount": "$account_id"
                },
                "ArnLike": {
                    "aws:SourceArn": [$source_arns]
                }
            }
        }
    ]
}
EOF
}

# 生成Policy JSON
generate_policy_document() {
    local account_id=$1
    
    # 构建各种资源ARN
    local ecr_resources=""
    local log_group_resources=""
    local log_group_all_resources=""
    local log_stream_resources=""
    local workload_resources=""
    local bedrock_resources=""
    
    for region in "${SUPPORTED_REGIONS[@]}"; do
        # ECR资源
        if [ -n "$ecr_resources" ]; then ecr_resources="$ecr_resources,"; fi
        ecr_resources="$ecr_resources\"arn:aws:ecr:$region:$account_id:repository/*\""
        
        # CloudWatch Logs资源
        if [ -n "$log_group_resources" ]; then log_group_resources="$log_group_resources,"; fi
        log_group_resources="$log_group_resources\"arn:aws:logs:$region:$account_id:log-group:/aws/bedrock-agentcore/runtimes/*\""
        
        if [ -n "$log_group_all_resources" ]; then log_group_all_resources="$log_group_all_resources,"; fi
        log_group_all_resources="$log_group_all_resources\"arn:aws:logs:$region:$account_id:log-group:*\""
        
        if [ -n "$log_stream_resources" ]; then log_stream_resources="$log_stream_resources,"; fi
        log_stream_resources="$log_stream_resources\"arn:aws:logs:$region:$account_id:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*\""
        
        # Workload Identity资源
        if [ -n "$workload_resources" ]; then workload_resources="$workload_resources,"; fi
        workload_resources="$workload_resources\"arn:aws:bedrock-agentcore:$region:$account_id:workload-identity-directory/default\""
        workload_resources="$workload_resources,\"arn:aws:bedrock-agentcore:$region:$account_id:workload-identity-directory/default/workload-identity/hosted_agent_01-*\""
        
        # Bedrock资源
        if [ -n "$bedrock_resources" ]; then bedrock_resources="$bedrock_resources,"; fi
        bedrock_resources="$bedrock_resources\"arn:aws:bedrock:$region:$account_id:*\""
    done
    
    # 添加Foundation Model资源
    bedrock_resources="\"arn:aws:bedrock:*::foundation-model/*\",$bedrock_resources"
    
    cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ECRImageAccess",
            "Effect": "Allow",
            "Action": [
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:GetAuthorizationToken"
            ],
            "Resource": [$ecr_resources]
        },
        {
            "Sid": "CloudWatchLogsAccess",
            "Effect": "Allow",
            "Action": [
                "logs:DescribeLogStreams",
                "logs:CreateLogGroup"
            ],
            "Resource": [$log_group_resources]
        },
        {
            "Sid": "CloudWatchLogsDescribe",
            "Effect": "Allow",
            "Action": ["logs:DescribeLogGroups"],
            "Resource": [$log_group_all_resources]
        },
        {
            "Sid": "CloudWatchLogsWrite",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": [$log_stream_resources]
        },
        {
            "Sid": "ECRTokenAccess",
            "Effect": "Allow",
            "Action": ["ecr:GetAuthorizationToken"],
            "Resource": "*"
        },
        {
            "Sid": "XRayAccess",
            "Effect": "Allow",
            "Action": [
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
                "xray:GetSamplingRules",
                "xray:GetSamplingTargets"
            ],
            "Resource": ["*"]
        },
        {
            "Sid": "CloudWatchMetrics",
            "Effect": "Allow",
            "Resource": "*",
            "Action": "cloudwatch:PutMetricData",
            "Condition": {
                "StringEquals": {
                    "cloudwatch:namespace": "bedrock-agentcore"
                }
            }
        },
        {
            "Sid": "GetAgentAccessToken",
            "Effect": "Allow",
            "Action": [
                "bedrock-agentcore:GetWorkloadAccessToken",
                "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                "bedrock-agentcore:GetWorkloadAccessTokenForUserId"
            ],
            "Resource": [$workload_resources]
        },
        {
            "Sid": "BedrockModelInvocation",
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream"
            ],
            "Resource": [$bedrock_resources]
        }
    ]
}
EOF
}

# 创建Role
create_role() {
    local account_id=$1
    local trust_policy
    
    log_info "创建IAM Role: $ROLE_NAME"
    
    trust_policy=$(generate_trust_policy "$account_id")
    log_debug "Trust Policy: $trust_policy"
    
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document "$trust_policy" \
        --description "Default service role for Amazon Bedrock AgentCore Runtime - Auto-created" \
        --max-session-duration 3600 > /dev/null
    
    log_success "Role创建成功: $ROLE_NAME"
}

# 创建并附加Policy
create_and_attach_policy() {
    local account_id=$1
    local policy_arn="arn:aws:iam::${account_id}:policy/${POLICY_NAME}"
    local policy_document
    
    # 检查Policy是否已存在
    if aws iam get-policy --policy-arn "$policy_arn" &> /dev/null; then
        log_info "Policy $POLICY_NAME 已存在，直接附加"
    else
        log_info "创建新Policy: $POLICY_NAME"
        policy_document=$(generate_policy_document "$account_id")
        log_debug "Policy Document: $policy_document"
        
        aws iam create-policy \
            --policy-name "$POLICY_NAME" \
            --policy-document "$policy_document" \
            --description "Policy for Amazon Bedrock AgentCore Runtime - Auto-created" > /dev/null
        
        log_success "Policy创建成功: $policy_arn"
    fi
    
    # 附加Policy到Role
    log_info "附加Policy到Role"
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn "$policy_arn"
    
    log_success "Policy附加成功: $policy_arn -> $ROLE_NAME"
}

# 预检查并创建Role
precheck_and_create() {
    local account_id
    
    log_info "开始AgentCore IAM Role预检查..."
    
    # 获取账户ID
    account_id=$(get_account_id)
    log_info "检测到AWS账户ID: $account_id"
    
    # 检查Role是否存在
    if check_role_exists; then
        log_info "Role $ROLE_NAME 已存在"
        
        # 检查Policy是否正确附加
        if check_policy_attached "$account_id"; then
            log_success "Role和Policy配置正确，无需操作"
            return 0
        else
            log_warning "Policy未正确附加，尝试修复..."
            create_and_attach_policy "$account_id"
            log_success "Policy修复完成"
            return 0
        fi
    fi
    
    # 创建Role和Policy
    create_role "$account_id"
    create_and_attach_policy "$account_id"
    
    log_success "✅ AgentCore IAM Role创建完成: $ROLE_NAME"
}

# 检查Role状态
check_role_status() {
    local account_id
    
    account_id=$(get_account_id)
    log_info "检查Role状态: $ROLE_NAME"
    
    if check_role_exists; then
        log_success "✅ Role存在: $ROLE_NAME"
        
        if check_policy_attached "$account_id"; then
            log_success "✅ Policy正确附加: $POLICY_NAME"
        else
            log_warning "❌ Policy未正确附加: $POLICY_NAME"
        fi
    else
        log_warning "❌ Role不存在: $ROLE_NAME"
    fi
}

# 删除Role和Policy
delete_role_and_policy() {
    local account_id
    local policy_arn
    
    account_id=$(get_account_id)
    policy_arn="arn:aws:iam::${account_id}:policy/${POLICY_NAME}"
    
    log_info "删除Role和Policy..."
    
    # 分离Policy
    if aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$policy_arn" 2>/dev/null; then
        log_success "Policy分离成功"
    else
        log_warning "Policy分离失败或已分离"
    fi
    
    # 删除Policy
    if aws iam delete-policy --policy-arn "$policy_arn" 2>/dev/null; then
        log_success "Policy删除成功: $policy_arn"
    else
        log_warning "Policy删除失败或不存在"
    fi
    
    # 删除Role
    if aws iam delete-role --role-name "$ROLE_NAME" 2>/dev/null; then
        log_success "Role删除成功: $ROLE_NAME"
    else
        log_warning "Role删除失败或不存在"
    fi
    
    log_success "✅ 清理完成"
}

# 显示帮助信息
show_help() {
    cat <<EOF
AgentCore IAM Role 管理脚本

使用方法:
    $0 [create|check|delete] [选项]

命令:
    create  - 预检查并创建Role和Policy（默认）
    check   - 检查Role和Policy状态
    delete  - 删除Role和Policy

环境变量:
    AGENTCORE_ROLE_NAME     - 自定义Role名称（默认: $DEFAULT_ROLE_NAME）
    AGENTCORE_POLICY_NAME   - 自定义Policy名称（默认: $DEFAULT_POLICY_NAME）
    AGENTCORE_VERBOSE       - 启用详细输出（true/false）

支持的区域:
    ${SUPPORTED_REGIONS[*]}

示例:
    $0 create                    # 创建Role和Policy
    $0 check                     # 检查状态
    $0 delete                    # 删除Role和Policy
    
    AGENTCORE_VERBOSE=true $0 create  # 详细输出模式
EOF
}

# 主函数
main() {
    local action="${1:-create}"
    
    case "$action" in
        "create")
            check_aws_cli
            precheck_and_create
            ;;
        "check")
            check_aws_cli
            check_role_status
            ;;
        "delete")
            check_aws_cli
            delete_role_and_policy
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            log_error "未知命令: $action"
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
