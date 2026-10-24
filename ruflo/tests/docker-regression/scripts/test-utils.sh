#!/bin/bash
# Claude-Flow Test Utilities
# Shared functions for test scripts

# Colors
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export NC='\033[0m'

# Test result tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Timer functions
start_timer() {
    START_TIME=$(date +%s.%N)
}

end_timer() {
    END_TIME=$(date +%s.%N)
    echo "$END_TIME - $START_TIME" | bc
}

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Test execution function
execute_test() {
    local test_name="$1"
    local command="$2"
    local expected_exit="${3:-0}"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -n "  Testing: ${test_name}... "

    start_timer
    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e
    duration=$(end_timer)

    if [ "$exit_code" -eq "$expected_exit" ]; then
        echo -e "${GREEN}✓ PASSED${NC} (${duration}s)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC} (exit: $exit_code, expected: $expected_exit)"
        echo "    Output: ${output:0:200}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Skip test
skip_test() {
    local test_name="$1"
    local reason="$2"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
    echo -e "  Testing: ${test_name}... ${YELLOW}⊘ SKIPPED${NC} ($reason)"
}

# Print summary
print_summary() {
    local category="$1"

    local pass_rate=0
    if [ $TOTAL_TESTS -gt 0 ]; then
        pass_rate=$(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc)
    fi

    echo ""
    echo "=== ${category} Summary ==="
    echo -e "Total:   ${BLUE}${TOTAL_TESTS}${NC}"
    echo -e "Passed:  ${GREEN}${PASSED_TESTS}${NC}"
    echo -e "Failed:  ${RED}${FAILED_TESTS}${NC}"
    echo -e "Skipped: ${YELLOW}${SKIPPED_TESTS}${NC}"
    echo -e "Rate:    ${CYAN}${pass_rate}%${NC}"
}

# Check command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Wait for service
wait_for_service() {
    local host="$1"
    local port="$2"
    local timeout="${3:-30}"

    log_info "Waiting for ${host}:${port}..."

    for i in $(seq 1 $timeout); do
        if nc -z "$host" "$port" 2>/dev/null; then
            log_success "Service available at ${host}:${port}"
            return 0
        fi
        sleep 1
    done

    log_error "Timeout waiting for ${host}:${port}"
    return 1
}

# Create temp directory
create_temp_dir() {
    local name="${1:-test}"
    mktemp -d "/tmp/${name}.XXXXXX"
}

# Cleanup temp directory
cleanup_temp_dir() {
    local dir="$1"
    if [ -d "$dir" ] && [[ "$dir" == /tmp/* ]]; then
        rm -rf "$dir"
    fi
}

# Assert equals
assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Assertion failed}"

    if [ "$expected" = "$actual" ]; then
        return 0
    else
        log_error "$message: expected '$expected', got '$actual'"
        return 1
    fi
}

# Assert contains
assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-Assertion failed}"

    if echo "$haystack" | grep -q "$needle"; then
        return 0
    else
        log_error "$message: '$needle' not found in output"
        return 1
    fi
}

# Assert file exists
assert_file_exists() {
    local file="$1"
    local message="${2:-File should exist}"

    if [ -f "$file" ]; then
        return 0
    else
        log_error "$message: $file does not exist"
        return 1
    fi
}

# Assert directory exists
assert_dir_exists() {
    local dir="$1"
    local message="${2:-Directory should exist}"

    if [ -d "$dir" ]; then
        return 0
    else
        log_error "$message: $dir does not exist"
        return 1
    fi
}

# Generate test report
generate_report() {
    local report_file="$1"
    local category="$2"

    cat >> "$report_file" << EOF
{
  "category": "$category",
  "total": $TOTAL_TESTS,
  "passed": $PASSED_TESTS,
  "failed": $FAILED_TESTS,
  "skipped": $SKIPPED_TESTS,
  "timestamp": "$(date -Iseconds)"
}
EOF
}
