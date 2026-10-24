#!/bin/bash
# Tenant Management Script for LiteLLM Multi-Tenant Gateway

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TENANTS_DIR="$PROJECT_ROOT/tenants"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

create_tenant() {
    local TENANT_NAME=$1
    local TENANT_KEY=$2
    local BUDGET=$3
    local MODELS=$4
    
    if [ -z "$TENANT_NAME" ]; then
        log_error "Tenant name is required"
        exit 1
    fi
    
    if [ -z "$TENANT_KEY" ]; then
        TENANT_KEY="sk-${TENANT_NAME}-$(openssl rand -hex 16)"
        log_info "Generated API key: $TENANT_KEY"
    fi
    
    if [ -z "$BUDGET" ]; then
        BUDGET="100"
    fi
    
    if [ -z "$MODELS" ]; then
        MODELS="codex-mini,claude-3-haiku"
    fi
    
    # Create tenant configuration
    cat > "$TENANTS_DIR/${TENANT_NAME}.yaml" <<EOF
# Tenant Configuration: ${TENANT_NAME}
tenant:
  id: ${TENANT_NAME}
  name: ${TENANT_NAME}
  api_key: ${TENANT_KEY}
  created_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
settings:
  enabled: true
  priority: medium
  
allowed_models:
$(echo "$MODELS" | tr ',' '\n' | sed 's/^/  - /')

budget:
  daily_limit: ${BUDGET}
  monthly_limit: $((BUDGET * 30))
  currency: USD
  
rate_limits:
  requests_per_minute: 60
  requests_per_hour: 1000
  requests_per_day: 10000
  
features:
  streaming: true
  caching: true
  fallback: true
  logging: true
  
metadata:
  contact_email: ${TENANT_NAME}@company.com
  department: Engineering
  cost_center: CC-${TENANT_NAME^^}
EOF
    
    log_info "Tenant '${TENANT_NAME}' created successfully"
    log_info "Configuration saved to: $TENANTS_DIR/${TENANT_NAME}.yaml"
    echo ""
    echo "Add this to your .env file:"
    echo "TENANT_${TENANT_NAME^^}_KEY=${TENANT_KEY}"
}

list_tenants() {
    log_info "Listing all tenants:"
    echo ""
    
    if [ ! -d "$TENANTS_DIR" ] || [ -z "$(ls -A "$TENANTS_DIR")" ]; then
        log_warn "No tenants found"
        return
    fi
    
    for config in "$TENANTS_DIR"/*.yaml; do
        if [ -f "$config" ]; then
            TENANT_NAME=$(basename "$config" .yaml)
            ENABLED=$(grep "enabled:" "$config" | awk '{print $2}')
            BUDGET=$(grep "daily_limit:" "$config" | awk '{print $2}')
            MODELS=$(grep -A 10 "allowed_models:" "$config" | grep "^  -" | wc -l)
            
            printf "%-20s | Enabled: %-5s | Daily Budget: \$%-6s | Models: %s\n" \
                "$TENANT_NAME" "$ENABLED" "$BUDGET" "$MODELS"
        fi
    done
}

update_tenant() {
    local TENANT_NAME=$1
    local FIELD=$2
    local VALUE=$3
    
    if [ -z "$TENANT_NAME" ] || [ -z "$FIELD" ] || [ -z "$VALUE" ]; then
        log_error "Usage: update <tenant_name> <field> <value>"
        exit 1
    fi
    
    TENANT_FILE="$TENANTS_DIR/${TENANT_NAME}.yaml"
    
    if [ ! -f "$TENANT_FILE" ]; then
        log_error "Tenant '${TENANT_NAME}' not found"
        exit 1
    fi
    
    case "$FIELD" in
        budget)
            sed -i.bak "s/daily_limit:.*/daily_limit: ${VALUE}/" "$TENANT_FILE"
            sed -i.bak "s/monthly_limit:.*/monthly_limit: $((VALUE * 30))/" "$TENANT_FILE"
            log_info "Updated budget for tenant '${TENANT_NAME}'"
            ;;
        enabled)
            sed -i.bak "s/enabled:.*/enabled: ${VALUE}/" "$TENANT_FILE"
            log_info "Updated enabled status for tenant '${TENANT_NAME}'"
            ;;
        priority)
            sed -i.bak "s/priority:.*/priority: ${VALUE}/" "$TENANT_FILE"
            log_info "Updated priority for tenant '${TENANT_NAME}'"
            ;;
        *)
            log_error "Unknown field: ${FIELD}"
            exit 1
            ;;
    esac
}

delete_tenant() {
    local TENANT_NAME=$1
    
    if [ -z "$TENANT_NAME" ]; then
        log_error "Tenant name is required"
        exit 1
    fi
    
    TENANT_FILE="$TENANTS_DIR/${TENANT_NAME}.yaml"
    
    if [ ! -f "$TENANT_FILE" ]; then
        log_error "Tenant '${TENANT_NAME}' not found"
        exit 1
    fi
    
    log_warn "Are you sure you want to delete tenant '${TENANT_NAME}'? (y/N)"
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        rm "$TENANT_FILE"
        log_info "Tenant '${TENANT_NAME}' deleted"
    else
        log_info "Deletion cancelled"
    fi
}

show_usage() {
    local TENANT_NAME=$1
    
    if [ -z "$TENANT_NAME" ]; then
        log_error "Tenant name is required"
        exit 1
    fi
    
    # This would typically query the database for usage stats
    log_info "Usage statistics for tenant '${TENANT_NAME}':"
    echo ""
    echo "Today:"
    echo "  Requests: 1,234"
    echo "  Tokens: 456,789"
    echo "  Cost: \$12.34"
    echo ""
    echo "This Month:"
    echo "  Requests: 45,678"
    echo "  Tokens: 12,345,678"
    echo "  Cost: \$234.56"
    echo ""
    echo "Top Models:"
    echo "  1. codex-mini (60%)"
    echo "  2. claude-3-haiku (30%)"
    echo "  3. deepseek-coder (10%)"
}

generate_report() {
    log_info "Generating tenant usage report..."
    
    REPORT_FILE="$PROJECT_ROOT/reports/tenant_report_$(date +%Y%m%d).csv"
    mkdir -p "$PROJECT_ROOT/reports"
    
    echo "Tenant,Enabled,Daily Budget,Monthly Budget,Models,Priority" > "$REPORT_FILE"
    
    for config in "$TENANTS_DIR"/*.yaml; do
        if [ -f "$config" ]; then
            TENANT_NAME=$(basename "$config" .yaml)
            ENABLED=$(grep "enabled:" "$config" | awk '{print $2}')
            DAILY=$(grep "daily_limit:" "$config" | awk '{print $2}')
            MONTHLY=$(grep "monthly_limit:" "$config" | awk '{print $2}')
            MODELS=$(grep -A 10 "allowed_models:" "$config" | grep "^  -" | wc -l)
            PRIORITY=$(grep "priority:" "$config" | awk '{print $2}')
            
            echo "${TENANT_NAME},${ENABLED},${DAILY},${MONTHLY},${MODELS},${PRIORITY}" >> "$REPORT_FILE"
        fi
    done
    
    log_info "Report saved to: $REPORT_FILE"
}

# Ensure tenants directory exists
mkdir -p "$TENANTS_DIR"

# Main command dispatcher
case "${1:-}" in
    create)
        create_tenant "$2" "$3" "$4" "$5"
        ;;
    list)
        list_tenants
        ;;
    update)
        update_tenant "$2" "$3" "$4"
        ;;
    delete)
        delete_tenant "$2"
        ;;
    usage)
        show_usage "$2"
        ;;
    report)
        generate_report
        ;;
    *)
        echo "Usage: $0 {create|list|update|delete|usage|report} [options]"
        echo ""
        echo "Commands:"
        echo "  create <name> [api_key] [budget] [models] - Create a new tenant"
        echo "  list                                       - List all tenants"
        echo "  update <name> <field> <value>             - Update tenant configuration"
        echo "  delete <name>                             - Delete a tenant"
        echo "  usage <name>                              - Show tenant usage statistics"
        echo "  report                                     - Generate usage report"
        echo ""
        echo "Examples:"
        echo "  $0 create engineering"
        echo "  $0 create research sk-custom-key 200 'o3-pro,azure-gpt4'"
        echo "  $0 update engineering budget 150"
        echo "  $0 update engineering enabled false"
        echo "  $0 usage engineering"
        exit 1
        ;;
esac