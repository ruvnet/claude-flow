#!/bin/bash
# LiteLLM Multi-Tenant Deployment Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

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

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check .env file
    if [ ! -f "$ENV_FILE" ]; then
        log_warn ".env file not found. Creating from example..."
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        log_warn "Please edit $ENV_FILE with your actual API keys and configuration."
        exit 1
    fi
    
    log_info "Prerequisites check passed ✓"
}

generate_keys() {
    log_info "Generating secure keys..."
    
    # Generate master key if not set
    if grep -q "LITELLM_MASTER_KEY=sk-litellm-master-key-change-me" "$ENV_FILE"; then
        NEW_MASTER_KEY="sk-litellm-$(openssl rand -hex 32)"
        sed -i.bak "s/LITELLM_MASTER_KEY=.*/LITELLM_MASTER_KEY=$NEW_MASTER_KEY/" "$ENV_FILE"
        log_info "Generated new LITELLM_MASTER_KEY"
    fi
    
    # Generate salt key if not set
    if grep -q "LITELLM_SALT_KEY=your-salt-key-for-encryption" "$ENV_FILE"; then
        NEW_SALT_KEY="$(openssl rand -hex 32)"
        sed -i.bak "s/LITELLM_SALT_KEY=.*/LITELLM_SALT_KEY=$NEW_SALT_KEY/" "$ENV_FILE"
        log_info "Generated new LITELLM_SALT_KEY"
    fi
    
    # Generate JWT secret if not set
    if grep -q "JWT_SECRET=your-jwt-secret-for-auth" "$ENV_FILE"; then
        NEW_JWT_SECRET="$(openssl rand -hex 64)"
        sed -i.bak "s/JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" "$ENV_FILE"
        log_info "Generated new JWT_SECRET"
    fi
    
    # Generate database password if not set
    if grep -q "DB_PASSWORD=secure-postgres-password" "$ENV_FILE"; then
        NEW_DB_PASSWORD="$(openssl rand -base64 32 | tr -d '=')"
        sed -i.bak "s/DB_PASSWORD=.*/DB_PASSWORD=$NEW_DB_PASSWORD/" "$ENV_FILE"
        log_info "Generated new DB_PASSWORD"
    fi
    
    log_info "Secure keys generated ✓"
}

create_directories() {
    log_info "Creating required directories..."
    
    mkdir -p "$PROJECT_ROOT/certs"
    mkdir -p "$PROJECT_ROOT/logs"
    mkdir -p "$PROJECT_ROOT/tenants"
    mkdir -p "$PROJECT_ROOT/config/grafana/dashboards"
    mkdir -p "$PROJECT_ROOT/config/grafana/datasources"
    
    log_info "Directories created ✓"
}

generate_ssl_cert() {
    log_info "Generating self-signed SSL certificate..."
    
    if [ ! -f "$PROJECT_ROOT/certs/litellm.crt" ]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$PROJECT_ROOT/certs/litellm.key" \
            -out "$PROJECT_ROOT/certs/litellm.crt" \
            -subj "/C=US/ST=State/L=City/O=LiteLLM/CN=litellm.local"
        log_info "SSL certificate generated ✓"
    else
        log_info "SSL certificate already exists ✓"
    fi
}

deploy_stack() {
    log_info "Deploying LiteLLM stack..."
    
    # Build images
    log_info "Building Docker images..."
    docker-compose -f "$COMPOSE_FILE" build
    
    # Start services
    log_info "Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    sleep 10
    
    # Check service health
    docker-compose -f "$COMPOSE_FILE" ps
    
    log_info "Stack deployed successfully ✓"
}

show_info() {
    log_info "==================================="
    log_info "LiteLLM Gateway deployed successfully!"
    log_info "==================================="
    echo ""
    echo "Access Points:"
    echo "  - LiteLLM Gateway: http://localhost:4000"
    echo "  - Grafana Dashboard: http://localhost:3000"
    echo "  - Prometheus: http://localhost:9090"
    echo "  - PgAdmin: http://localhost:5050"
    echo ""
    echo "Default Credentials:"
    echo "  - Grafana: admin / (check .env file)"
    echo "  - PgAdmin: admin@litellm.local / (check .env file)"
    echo ""
    echo "Configure Claude Code:"
    echo "  export ANTHROPIC_BASE_URL=http://localhost:4000"
    echo "  export ANTHROPIC_AUTH_TOKEN=<your-master-key>"
    echo "  claude --model codex-mini \"Your prompt here\""
    echo ""
    echo "View logs:"
    echo "  docker-compose -f $COMPOSE_FILE logs -f"
    echo ""
    echo "Stop services:"
    echo "  docker-compose -f $COMPOSE_FILE down"
}

# Main execution
main() {
    log_info "Starting LiteLLM Multi-Tenant Gateway deployment..."
    
    check_prerequisites
    generate_keys
    create_directories
    generate_ssl_cert
    deploy_stack
    show_info
}

# Parse command line arguments
case "${1:-}" in
    start)
        main
        ;;
    stop)
        log_info "Stopping LiteLLM stack..."
        docker-compose -f "$COMPOSE_FILE" down
        log_info "Stack stopped ✓"
        ;;
    restart)
        log_info "Restarting LiteLLM stack..."
        docker-compose -f "$COMPOSE_FILE" restart
        log_info "Stack restarted ✓"
        ;;
    logs)
        docker-compose -f "$COMPOSE_FILE" logs -f
        ;;
    status)
        docker-compose -f "$COMPOSE_FILE" ps
        ;;
    clean)
        log_warn "This will remove all containers, volumes, and data. Are you sure? (y/N)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            docker-compose -f "$COMPOSE_FILE" down -v
            log_info "Stack cleaned ✓"
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|logs|status|clean}"
        echo ""
        echo "Commands:"
        echo "  start   - Deploy the LiteLLM stack"
        echo "  stop    - Stop all services"
        echo "  restart - Restart all services"
        echo "  logs    - Show logs (follow mode)"
        echo "  status  - Show service status"
        echo "  clean   - Remove all containers and volumes"
        exit 1
        ;;
esac