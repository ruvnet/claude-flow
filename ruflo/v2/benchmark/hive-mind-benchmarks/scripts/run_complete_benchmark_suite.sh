#!/bin/bash

# Complete Hive Mind Benchmark Suite Runner
# Integrates all automation components for comprehensive testing

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARK_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$BENCHMARK_DIR")")")

# Default values
PROFILE="quick"
TIMEOUT_MINUTES=60
PARALLEL_WORKERS=2
OUTPUT_DIR="automated-benchmark-results"
GENERATE_REPORT=true
CLEANUP_ON_EXIT=true
VERBOSE=false
DRY_RUN=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "[DEBUG] $1"
    fi
}

# Usage function
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Run the complete Hive Mind benchmark automation suite.

Options:
    -p, --profile PROFILE       Benchmark profile (quick|standard|comprehensive|stress) [default: quick]
    -t, --timeout MINUTES       Timeout in minutes [default: 60]
    -w, --workers COUNT          Number of parallel workers [default: 2]
    -o, --output-dir DIR         Output directory [default: automated-benchmark-results]
    -n, --no-report             Skip HTML report generation
    -c, --no-cleanup            Skip cleanup on exit
    -v, --verbose               Verbose output
    -d, --dry-run               Show what would be executed without running
    -h, --help                  Show this help message

Examples:
    $0                          # Run quick benchmark with defaults
    $0 -p standard -t 120       # Run standard benchmark with 2-hour timeout
    $0 -p comprehensive -w 4    # Run comprehensive benchmark with 4 workers
    $0 -d -p stress             # Dry run of stress benchmark

Environment Variables:
    BENCHMARK_PROFILE           Override profile selection
    BENCHMARK_TIMEOUT           Override timeout in minutes
    PARALLEL_WORKERS           Override worker count
    LOG_LEVEL                  Set log level (DEBUG|INFO|WARNING|ERROR)
    NO_COLOR                   Disable colored output

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--profile)
                PROFILE="$2"
                shift 2
                ;;
            -t|--timeout)
                TIMEOUT_MINUTES="$2"
                shift 2
                ;;
            -w|--workers)
                PARALLEL_WORKERS="$2"
                shift 2
                ;;
            -o|--output-dir)
                OUTPUT_DIR="$2"
                shift 2
                ;;
            -n|--no-report)
                GENERATE_REPORT=false
                shift
                ;;
            -c|--no-cleanup)
                CLEANUP_ON_EXIT=false
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
    
    # Override with environment variables if set
    PROFILE="${BENCHMARK_PROFILE:-$PROFILE}"
    TIMEOUT_MINUTES="${BENCHMARK_TIMEOUT:-$TIMEOUT_MINUTES}"
    PARALLEL_WORKERS="${PARALLEL_WORKERS:-$PARALLEL_WORKERS}"
    
    # Validate profile
    if [[ ! "$PROFILE" =~ ^(quick|standard|comprehensive|stress)$ ]]; then
        log_error "Invalid profile: $PROFILE. Must be one of: quick, standard, comprehensive, stress"
        exit 1
    fi
    
    # Validate numeric values
    if ! [[ "$TIMEOUT_MINUTES" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_MINUTES" -lt 1 ]]; then
        log_error "Invalid timeout: $TIMEOUT_MINUTES. Must be a positive integer."
        exit 1
    fi
    
    if ! [[ "$PARALLEL_WORKERS" =~ ^[0-9]+$ ]] || [[ "$PARALLEL_WORKERS" -lt 1 ]]; then
        log_error "Invalid worker count: $PARALLEL_WORKERS. Must be a positive integer."
        exit 1
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_deps=()
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        missing_deps+=("python3")
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        missing_deps+=("node")
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        missing_deps+=("npm")
    fi
    
    # Check required Python packages
    if ! python3 -c "import psutil, pandas, numpy, matplotlib" &> /dev/null; then
        log_warning "Some Python packages are missing. Run: pip install -r requirements.txt"
    fi
    
    # Check if CLI exists
    if [[ ! -f "$PROJECT_ROOT/src/cli/simple-cli.js" ]]; then
        missing_deps+=("Claude Flow CLI at $PROJECT_ROOT/src/cli/simple-cli.js")
    fi
    
    # Check configuration file
    if [[ ! -f "$BENCHMARK_DIR/config/test-config.json" ]]; then
        missing_deps+=("Configuration file at $BENCHMARK_DIR/config/test-config.json")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing prerequisites:"
        for dep in "${missing_deps[@]}"; do
            log_error "  - $dep"
        done
        exit 1
    fi
    
    log_success "All prerequisites satisfied"
}

# Setup environment
setup_environment() {
    log_info "Setting up benchmark environment..."
    
    # Create output directory
    mkdir -p "$OUTPUT_DIR"
    
    # Set environment variables
    export NODE_ENV=test
    export PYTHON_ENV=test
    export LOG_LEVEL=${LOG_LEVEL:-INFO}
    export BENCHMARK_OUTPUT_DIR="$OUTPUT_DIR"
    
    # Create temporary directories
    export TEMP_DIR="$(mktemp -d)"
    
    log_debug "Output directory: $OUTPUT_DIR"
    log_debug "Temporary directory: $TEMP_DIR"
    log_debug "Working directory: $(pwd)"
    
    log_success "Environment setup complete"
}

# Cleanup function
cleanup() {
    if [[ "$CLEANUP_ON_EXIT" == "true" ]]; then
        log_info "Cleaning up temporary files..."
        if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
            rm -rf "$TEMP_DIR"
        fi
        log_success "Cleanup complete"
    fi
}

# Signal handlers
handle_interrupt() {
    log_warning "Received interrupt signal, cleaning up..."
    cleanup
    exit 130
}

handle_termination() {
    log_warning "Received termination signal, cleaning up..."
    cleanup
    exit 143
}

# Run benchmark tests
run_benchmarks() {
    log_info "Starting benchmark execution..."
    log_info "Profile: $PROFILE"
    log_info "Timeout: $TIMEOUT_MINUTES minutes"
    log_info "Workers: $PARALLEL_WORKERS"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Would execute automated_test_runner.py with:"
        log_info "  --profile $PROFILE"
        log_info "  --timeout $TIMEOUT_MINUTES"
        log_info "  --output-dir $OUTPUT_DIR"
        if [[ "$VERBOSE" == "true" ]]; then
            log_info "  --verbose"
        fi
        return 0
    fi
    
    local start_time=$(date +%s)
    local cmd_args=(
        "--profile" "$PROFILE"
        "--timeout" "$TIMEOUT_MINUTES"
        "--output-dir" "$OUTPUT_DIR"
    )
    
    if [[ "$VERBOSE" == "false" ]]; then
        cmd_args+=("--quiet")
    fi
    
    # Change to benchmark directory
    cd "$BENCHMARK_DIR"
    
    # Run the automated test runner
    log_info "Executing: python3 scripts/automated_test_runner.py ${cmd_args[*]}"
    
    if python3 scripts/automated_test_runner.py "${cmd_args[@]}"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_success "Benchmark execution completed in ${duration} seconds"
        return 0
    else
        local exit_code=$?
        log_error "Benchmark execution failed with exit code $exit_code"
        return $exit_code
    fi
}

# Collect and analyze results
collect_results() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Would collect and analyze results from $OUTPUT_DIR"
        return 0
    fi
    
    log_info "Collecting and analyzing results..."
    
    if [[ ! -d "$OUTPUT_DIR" ]]; then
        log_warning "Output directory $OUTPUT_DIR does not exist, skipping result collection"
        return 0
    fi
    
    # Count result files
    local result_count=$(find "$OUTPUT_DIR" -name "*.json" -o -name "*.csv" | wc -l)
    if [[ "$result_count" -eq 0 ]]; then
        log_warning "No result files found in $OUTPUT_DIR"
        return 0
    fi
    
    log_info "Found $result_count result files"
    
    # Run result collector
    local collector_args=(
        "--collect" "$OUTPUT_DIR"
        "--analyze"
        "--time-window" "1d"
    )
    
    if [[ "$GENERATE_REPORT" == "true" ]]; then
        collector_args+=("--visualize" "--report")
    fi
    
    cd "$BENCHMARK_DIR"
    
    if python3 scripts/result_collector.py "${collector_args[@]}"; then
        log_success "Result collection and analysis completed"
        
        # Show generated files
        log_info "Generated files:"
        find "$OUTPUT_DIR" -type f -name "*.html" -o -name "*.png" -o -name "*.csv" | head -10 | while read -r file; do
            log_info "  - $file"
        done
        
        return 0
    else
        log_error "Result collection failed"
        return 1
    fi
}

# Generate summary report
generate_summary() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Would generate summary report"
        return 0
    fi
    
    log_info "Generating execution summary..."
    
    local summary_file="$OUTPUT_DIR/execution_summary.txt"
    cat > "$summary_file" << EOF
Hive Mind Benchmark Execution Summary
====================================

Execution Details:
- Profile: $PROFILE
- Timeout: $TIMEOUT_MINUTES minutes
- Workers: $PARALLEL_WORKERS
- Output Directory: $OUTPUT_DIR
- Executed At: $(date)
- Executed By: $(whoami)
- Host: $(hostname)

System Information:
- OS: $(uname -s) $(uname -r)
- Architecture: $(uname -m)
- Python: $(python3 --version 2>&1)
- Node.js: $(node --version 2>&1)

Generated Files:
EOF
    
    # List all generated files
    find "$OUTPUT_DIR" -type f | sort >> "$summary_file"
    
    log_success "Summary report generated: $summary_file"
}

# Main execution function
main() {
    log_info "Starting Hive Mind Benchmark Automation Suite"
    
    # Setup signal handlers
    trap handle_interrupt INT
    trap handle_termination TERM
    trap cleanup EXIT
    
    # Parse arguments
    parse_args "$@"
    
    # Check prerequisites
    check_prerequisites
    
    # Setup environment
    setup_environment
    
    # Run benchmarks
    if ! run_benchmarks; then
        log_error "Benchmark execution failed"
        exit 1
    fi
    
    # Collect and analyze results
    if ! collect_results; then
        log_warning "Result collection failed, but benchmarks completed"
    fi
    
    # Generate summary
    generate_summary
    
    log_success "Hive Mind Benchmark Automation Suite completed successfully!"
    log_info "Results available in: $OUTPUT_DIR"
    
    # Show HTML report if generated
    local html_report=$(find "$OUTPUT_DIR" -name "*.html" | head -1)
    if [[ -n "$html_report" ]]; then
        log_info "HTML Report: $html_report"
        log_info "Open with: open $html_report  # macOS"
        log_info "Open with: xdg-open $html_report  # Linux"
    fi
}

# Execute main function with all arguments
main "$@"