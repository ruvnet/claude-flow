#!/bin/bash
# Claude Flow V3 Configuration Validator Template (Linux/macOS)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

ERRORS=0
WARNINGS=0

log_error() { echo -e "${RED}❌ ERROR: $1${RESET}"; ((ERRORS++)); }
log_warning() { echo -e "${YELLOW}⚠️  WARNING: $1${RESET}"; ((WARNINGS++)); }
log_success() { echo -e "${GREEN}✅ $1${RESET}"; }
log_info() { echo -e "${BLUE}ℹ️  $1${RESET}"; }

echo -e "${BLUE}🔍 Claude Flow V3 Configuration Validation${RESET}"
echo "==========================================="
echo ""

# Check required directories
echo "📁 Checking Directory Structure..."
required_dirs=(".claude" ".claude/helpers" ".claude-flow/metrics" ".claude-flow/security")

for dir in "${required_dirs[@]}"; do
    if [ -d "$dir" ]; then
        log_success "Directory exists: $dir"
    else
        log_error "Missing required directory: $dir"
    fi
done

# Check required files
echo ""
echo "📄 Checking Required Files..."
required_files=(".claude-flow/metrics/v3-progress.json" ".claude-flow/metrics/performance.json" ".claude-flow/security/audit-status.json")

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        log_success "File exists: $file"
        # Validate JSON
        if jq empty "$file" >/dev/null 2>&1; then
            log_success "Valid JSON: $file"
        else
            log_error "Invalid JSON: $file"
        fi
    else
        log_warning "Missing file: $file (will be created as needed)"
    fi
done

# Check development tools
echo ""
echo "🔧 Checking Development Tools..."
tools=("git" "jq")

for tool in "${tools[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
        version=$($tool --version 2>/dev/null | head -n1 || echo "unknown")
        log_success "$tool installed: $version"
    else
        log_error "$tool not installed"
    fi
done

# Check Git repository
echo ""
echo "🔀 Checking Git Configuration..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log_success "Git repository detected"
    branch=$(git branch --show-current 2>/dev/null || echo "unknown")
    log_info "Current branch: $branch"
else
    log_warning "Not in a Git repository"
fi

# Platform-specific checks
echo ""
echo "💻 Platform-Specific Checks..."
case "$(uname -s)" in
    Linux*)
        log_success "Platform: Linux"
        if command -v systemctl >/dev/null 2>&1; then
            log_info "Systemd available"
        fi
        ;;
    Darwin*)
        log_success "Platform: macOS"
        if command -v brew >/dev/null 2>&1; then
            log_info "Homebrew available"
        fi
        ;;
    *)
        log_warning "Unknown platform: $(uname -s)"
        ;;
esac

# Summary
echo ""
echo "📊 Validation Summary"
echo "===================="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    log_success "All checks passed! V3 development environment is ready."
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠️  $WARNINGS warnings found, but no critical errors.${RESET}"
    log_info "V3 development can proceed with minor issues to address."
    exit 0
else
    echo -e "${RED}❌ $ERRORS critical errors found.${RESET}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠️  $WARNINGS warnings also found.${RESET}"
    fi
    log_error "Please fix critical errors before proceeding with V3 development."
    exit 1
fi