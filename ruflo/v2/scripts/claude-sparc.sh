#!/bin/bash

# SPARC Automated Development System
# Generic workflow for comprehensive software development using SPARC methodology

set -e  # Exit on any error

# Default configuration
PROJECT_NAME="sparc-project"
README_PATH="README.md"
MCP_CONFIG=".roo/mcp.json"
VERBOSE=false
DRY_RUN=false
SKIP_RESEARCH=false
SKIP_TESTS=false
TEST_COVERAGE_TARGET=100
PARALLEL_EXECUTION=true
COMMIT_FREQUENCY="phase"  # phase, feature, or manual
OUTPUT_FORMAT="text"
DEVELOPMENT_MODE="full"   # full, backend-only, frontend-only, api-only

# Help function
show_help() {
    cat << EOF
SPARC Automated Development System
==================================

A comprehensive, automated software development workflow using SPARC methodology
(Specification, Pseudocode, Architecture, Refinement, Completion)

USAGE:
    ./claude-sparc.sh [OPTIONS] [PROJECT_NAME] [README_PATH]

ARGUMENTS:
    PROJECT_NAME    Name of the project to develop (default: sparc-project)
    README_PATH     Path to initial requirements/readme file (default: readme.md)

OPTIONS:
    -h, --help                  Show this help message
    -v, --verbose              Enable verbose output
    -d, --dry-run              Show what would be done without executing
    -c, --config FILE          MCP configuration file (default: .roo/mcp.json)
    
    # Research Options
    --skip-research            Skip the web research phase
    --research-depth LEVEL     Research depth: basic, standard, comprehensive (default: standard)
    
    # Development Options
    --mode MODE                Development mode: full, backend-only, frontend-only, api-only (default: full)
    --skip-tests               Skip test development (not recommended)
    --coverage TARGET          Test coverage target percentage (default: 100)
    --no-parallel              Disable parallel execution
    
    # Commit Options
    --commit-freq FREQ         Commit frequency: phase, feature, manual (default: phase)
    --no-commits               Disable automatic commits
    
    # Output Options
    --output FORMAT            Output format: text, json, markdown (default: text)
    --quiet                    Suppress non-essential output

EXAMPLES:
    # Basic usage
    ./claude-sparc.sh my-app docs/requirements.md
    
    # Backend API development with verbose output
    ./claude-sparc.sh --mode api-only --verbose user-service api-spec.md
    
    # Quick prototype without research
    ./claude-sparc.sh --skip-research --coverage 80 prototype-app readme.md
    
    # Dry run to see what would be executed
    ./claude-sparc.sh --dry-run --verbose my-project requirements.md

DEVELOPMENT MODES:
    full            Complete full-stack development (default)
    backend-only    Backend services and APIs only
    frontend-only   Frontend application only
    api-only        REST/GraphQL API development only

RESEARCH DEPTHS:
    basic           Quick domain overview and technology stack research
    standard        Comprehensive research including competitive analysis (default)
    comprehensive   Extensive research with academic papers and detailed analysis

COMMIT FREQUENCIES:
    phase           Commit after each SPARC phase completion (default)
    feature         Commit after each feature implementation
    manual          No automatic commits (manual git operations only)

For more information, see SPARC-DEVELOPMENT-GUIDE.md
EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -c|--config)
                MCP_CONFIG="$2"
                shift 2
                ;;
            --skip-research)
                SKIP_RESEARCH=true
                shift
                ;;
            --research-depth)
                RESEARCH_DEPTH="$2"
                shift 2
                ;;
            --mode)
                DEVELOPMENT_MODE="$2"
                shift 2
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --coverage)
                TEST_COVERAGE_TARGET="$2"
                shift 2
                ;;
            --no-parallel)
                PARALLEL_EXECUTION=false
                shift
                ;;
            --commit-freq)
                COMMIT_FREQUENCY="$2"
                shift 2
                ;;
            --no-commits)
                COMMIT_FREQUENCY="manual"
                shift
                ;;
            --output)
                OUTPUT_FORMAT="$2"
                shift 2
                ;;
            --quiet)
                VERBOSE=false
                shift
                ;;
            -*)
                echo "Unknown option: $1" >&2
                echo "Use --help for usage information" >&2
                exit 1
                ;;
            *)
                if [[ "$PROJECT_NAME" == "sparc-project" ]]; then
                    PROJECT_NAME="$1"
                elif [[ "$README_PATH" == "README.md" ]]; then
                    README_PATH="$1"
                else
                    echo "Too many arguments: $1" >&2
                    echo "Use --help for usage information" >&2
                    exit 1
                fi
                shift
                ;;
        esac
    done
}

# Validate configuration
validate_config() {
    # Check if MCP config exists
    if [[ ! -f "$MCP_CONFIG" ]]; then
        echo "Warning: MCP config file not found: $MCP_CONFIG" >&2
        echo "Using default MCP configuration" >&2
    fi
    
    # Check if README exists, try to find alternatives if default doesn't exist
    if [[ ! -f "$README_PATH" ]]; then
        # Try common README file variations
        local readme_alternatives=("README.md" "readme.md" "Readme.md" "README.txt" "readme.txt")
        local found_readme=""
        
        for alt in "${readme_alternatives[@]}"; do
            if [[ -f "$alt" ]]; then
                found_readme="$alt"
                break
            fi
        done
        
        if [[ -n "$found_readme" ]]; then
            echo "README file '$README_PATH' not found, using '$found_readme' instead" >&2
            README_PATH="$found_readme"
        else
            echo "Error: No README file found. Tried: ${readme_alternatives[*]}" >&2
            echo "Please specify a valid README file path or create one of the above files." >&2
            exit 1
        fi
    fi
    
    # Validate development mode
    case $DEVELOPMENT_MODE in
        full|backend-only|frontend-only|api-only) ;;
        *) echo "Error: Invalid development mode: $DEVELOPMENT_MODE" >&2; exit 1 ;;
    esac
    
    # Validate commit frequency
    case $COMMIT_FREQUENCY in
        phase|feature|manual) ;;
        *) echo "Error: Invalid commit frequency: $COMMIT_FREQUENCY" >&2; exit 1 ;;
    esac
    
    # Validate output format
    case $OUTPUT_FORMAT in
        text|json|markdown) ;;
        *) echo "Error: Invalid output format: $OUTPUT_FORMAT" >&2; exit 1 ;;
    esac
    
    # Validate coverage target
    if [[ ! "$TEST_COVERAGE_TARGET" =~ ^[0-9]+$ ]] || [[ "$TEST_COVERAGE_TARGET" -lt 0 ]] || [[ "$TEST_COVERAGE_TARGET" -gt 100 ]]; then
        echo "Error: Invalid coverage target: $TEST_COVERAGE_TARGET (must be 0-100)" >&2
        exit 1
    fi
}

# Show configuration
show_config() {
    if [[ "$VERBOSE" == true ]]; then
        cat << EOF
SPARC Configuration:
===================
Project Name: $PROJECT_NAME
README Path: $README_PATH
MCP Config: $MCP_CONFIG
Development Mode: $DEVELOPMENT_MODE
Research Depth: ${RESEARCH_DEPTH:-standard}
Test Coverage Target: $TEST_COVERAGE_TARGET%
Parallel Execution: $PARALLEL_EXECUTION
Commit Frequency: $COMMIT_FREQUENCY
Output Format: $OUTPUT_FORMAT
Skip Research: $SKIP_RESEARCH
Skip Tests: $SKIP_TESTS
Dry Run: $DRY_RUN
===================
EOF
    fi
}

# Build allowed tools based on configuration
build_allowed_tools() {
    local tools="View,Edit,Replace,GlobTool,GrepTool,LS,Bash"
    
    if [[ "$SKIP_RESEARCH" != true ]]; then
        tools="$tools,WebFetchTool"
    fi
    
    if [[ "$PARALLEL_EXECUTION" == true ]]; then
        tools="$tools,BatchTool,dispatch_agent"
    fi
    
    echo "$tools"
}

# Build Claude command flags
build_claude_flags() {
    local flags="--mcp-config $MCP_CONFIG --dangerously-skip-permissions"
    
    if [[ "$VERBOSE" == true ]]; then
        flags="$flags --verbose"
    fi
    
    if [[ "$OUTPUT_FORMAT" != "text" ]]; then
        flags="$flags --output-format $OUTPUT_FORMAT"
    fi
    
    echo "$flags"
}

# Main execution
main() {
    parse_args "$@"
    validate_config
    show_config
    
    if [[ "$DRY_RUN" == true ]]; then
        echo "DRY RUN - Would execute the following:"
        echo "Project: $PROJECT_NAME"
        echo "README: $README_PATH"
        echo "Allowed Tools: $(build_allowed_tools)"
        echo "Claude Flags: $(build_claude_flags)"
        exit 0
    fi
    
    # Execute the SPARC development process
    execute_sparc_development
}

# Execute SPARC development process
execute_sparc_development() {
    local allowed_tools=$(build_allowed_tools)
    local claude_flags=$(build_claude_flags)

claude "
# SPARC Automated Development System
# Project: ${PROJECT_NAME}
# Initial Research Document: ${README_PATH}
# Configuration: Mode=${DEVELOPMENT_MODE}, Coverage=${TEST_COVERAGE_TARGET}%, Parallel=${PARALLEL_EXECUTION}

$(if [[ "$SKIP_RESEARCH" != true ]]; then cat << 'RESEARCH_BLOCK'
## PHASE 0: COMPREHENSIVE RESEARCH & DISCOVERY
### Research Depth: ${RESEARCH_DEPTH:-standard}
### Parallel Web Research Phase ($(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "BatchTool execution"; else echo "Sequential execution"; fi)):

1. **Domain Research**:
   - WebFetchTool: Extract key concepts from ${README_PATH}
   - WebFetchTool: Search for latest industry trends and technologies
   - WebFetchTool: Research competitive landscape and existing solutions
   $(if [[ "${RESEARCH_DEPTH:-standard}" == "comprehensive" ]]; then echo "   - WebFetchTool: Gather academic papers and technical documentation"; fi)

2. **Technology Stack Research**:
   - WebFetchTool: Research best practices for identified technology domains
   - WebFetchTool: Search for framework comparisons and recommendations
   - WebFetchTool: Investigate security considerations and compliance requirements
   $(if [[ "${RESEARCH_DEPTH:-standard}" != "basic" ]]; then echo "   - WebFetchTool: Research scalability patterns and architecture approaches"; fi)

3. **Implementation Research**:
   - WebFetchTool: Search for code examples and implementation patterns
   $(if [[ "$SKIP_TESTS" != true ]]; then echo "   - WebFetchTool: Research testing frameworks and methodologies"; fi)
   - WebFetchTool: Investigate deployment and DevOps best practices
   $(if [[ "${RESEARCH_DEPTH:-standard}" == "comprehensive" ]]; then echo "   - WebFetchTool: Research monitoring and observability solutions"; fi)

### Research Processing:
$(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "Use BatchTool to execute all research queries in parallel for maximum efficiency."; else echo "Execute research queries sequentially for thorough analysis."; fi)

$(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "**Commit**: 'feat: complete comprehensive research phase - gathered domain knowledge, technology insights, and implementation patterns'"; fi)
RESEARCH_BLOCK
fi)

## SPECIFICATION PHASE
### Requirements Analysis for ${DEVELOPMENT_MODE} development:
1. **Functional Requirements**:
   - Analyze ${README_PATH} to extract core functionality
   - Define user stories and acceptance criteria
   - Identify system boundaries and interfaces
   $(if [[ "$DEVELOPMENT_MODE" == "full" || "$DEVELOPMENT_MODE" == "backend-only" || "$DEVELOPMENT_MODE" == "api-only" ]]; then echo "   - Specify API endpoints and data models"; fi)
   $(if [[ "$DEVELOPMENT_MODE" == "full" || "$DEVELOPMENT_MODE" == "frontend-only" ]]; then echo "   - Define user interface requirements and user experience flows"; fi)

2. **Non-Functional Requirements**:
   - Security and compliance requirements
   - Performance benchmarks and SLAs
   - Scalability and availability targets
   - Maintainability and extensibility goals

3. **Technical Constraints**:
   - Technology stack decisions based on research
   - Integration requirements and dependencies
   - Deployment and infrastructure constraints
   - Budget and timeline considerations

$(if [[ "$COMMIT_FREQUENCY" == "phase" ]]; then echo "**Commit**: 'docs: complete specification phase - defined functional/non-functional requirements and technical constraints for ${DEVELOPMENT_MODE} development'"; fi)

## PSEUDOCODE PHASE
### High-Level Architecture Design for ${DEVELOPMENT_MODE}:
1. **System Architecture**:
   $(if [[ "$DEVELOPMENT_MODE" == "full" || "$DEVELOPMENT_MODE" == "backend-only" ]]; then echo "   - Define backend components and their responsibilities"; fi)
   $(if [[ "$DEVELOPMENT_MODE" == "full" || "$DEVELOPMENT_MODE" == "frontend-only" ]]; then echo "   - Design frontend architecture and component hierarchy"; fi)
   $(if [[ "$DEVELOPMENT_MODE" == "api-only" ]]; then echo "   - Define API architecture and endpoint structure"; fi)
   - Design data flow and communication patterns
   - Specify APIs and integration points
   - Plan error handling and recovery strategies

2. **Algorithm Design**:
   - Core business logic algorithms
   - Data processing and transformation logic
   - Optimization strategies and performance considerations
   - Security and validation algorithms

$(if [[ "$SKIP_TESTS" != true ]]; then cat << 'TEST_BLOCK'
3. **Test Strategy**:
   - Unit testing approach (TDD London School)
   - Integration testing strategy
   - End-to-end testing scenarios
   - Target: ${TEST_COVERAGE_TARGET}% test coverage
   $(if [[ "$DEVELOPMENT_MODE" == "full" ]]; then echo "   - Frontend and backend testing coordination"; fi)
TEST_BLOCK
fi)

$(if [[ "$COMMIT_FREQUENCY" == "phase" ]]; then echo "**Commit**: 'design: complete pseudocode phase - defined system architecture, algorithms, and test strategy for ${DEVELOPMENT_MODE}'"; fi)

## ARCHITECTURE PHASE
### Detailed System Design for ${DEVELOPMENT_MODE}:
1. **Component Architecture**:
   - Detailed component specifications
   - Interface definitions and contracts
   - Dependency injection and inversion of control
   - Configuration management strategy

$(if [[ "$DEVELOPMENT_MODE" == "full" || "$DEVELOPMENT_MODE" == "backend-only" || "$DEVELOPMENT_MODE" == "api-only" ]]; then cat << 'DATA_BLOCK'
2. **Data Architecture**:
   - Database schema design
   - Data access patterns and repositories
   - Caching strategies and data flow
   - Backup and recovery procedures
DATA_BLOCK
fi)

3. **Infrastructure Architecture**:
   - Deployment architecture and environments
   - CI/CD pipeline design
   - Monitoring and logging architecture
   - Security architecture and access controls

$(if [[ "$COMMIT_FREQUENCY" == "phase" ]]; then echo "**Commit**: 'arch: complete architecture phase - detailed component, data, and infrastructure design for ${DEVELOPMENT_MODE}'"; fi)

## REFINEMENT PHASE (TDD Implementation)
### $(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "Parallel"; else echo "Sequential"; fi) Development Tracks for ${DEVELOPMENT_MODE}:

$(if [[ "$DEVELOPMENT_MODE" == "full" || "$DEVELOPMENT_MODE" == "backend-only" || "$DEVELOPMENT_MODE" == "api-only" ]]; then cat << 'BACKEND_BLOCK'
#### Track 1: Backend Development
1. **Setup & Infrastructure**:
   - Bash: Initialize project structure
   - Bash: Setup development environment
   - Bash: Configure CI/CD pipeline
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'feat: initialize backend infrastructure and development environment'"; fi)

$(if [[ "$SKIP_TESTS" != true ]]; then cat << 'BACKEND_TDD_BLOCK'
2. **TDD Core Components** (London School):
   - Red: Write failing tests for core business logic
   - Green: Implement minimal code to pass tests
   - Refactor: Optimize while maintaining green tests
   - Target: ${TEST_COVERAGE_TARGET}% coverage
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'feat: implement core business logic with TDD - ${TEST_COVERAGE_TARGET}% test coverage'"; fi)
BACKEND_TDD_BLOCK
fi)

3. **API Layer Development**:
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Red: Write API contract tests"; else echo "Implement API endpoints"; fi)
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Green: Implement API endpoints"; else echo "Add input validation and error handling"; fi)
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Refactor: Optimize API performance"; else echo "Optimize API performance"; fi)
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'feat: complete API layer with $(if [[ "$SKIP_TESTS" != true ]]; then echo "comprehensive test coverage"; else echo "validation and error handling"; fi)'"; fi)
BACKEND_BLOCK
fi)

$(if [[ "$DEVELOPMENT_MODE" == "full" || "$DEVELOPMENT_MODE" == "frontend-only" ]]; then cat << 'FRONTEND_BLOCK'
#### Track 2: Frontend Development
1. **UI Component Library**:
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Red: Write component tests"; else echo "Implement UI components"; fi)
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Green: Implement UI components"; else echo "Add component styling and interactions"; fi)
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Refactor: Optimize for reusability"; else echo "Optimize for reusability and performance"; fi)
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'feat: complete UI component library with $(if [[ "$SKIP_TESTS" != true ]]; then echo "full test coverage"; else echo "optimized components"; fi)'"; fi)

2. **Application Logic**:
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Red: Write application flow tests"; else echo "Implement user interactions"; fi)
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Green: Implement user interactions"; else echo "Add state management and routing"; fi)
   - $(if [[ "$SKIP_TESTS" != true ]]; then echo "Refactor: Optimize user experience"; else echo "Optimize user experience and performance"; fi)
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'feat: complete frontend application logic with $(if [[ "$SKIP_TESTS" != true ]]; then echo "end-to-end tests"; else echo "optimized user experience"; fi)'"; fi)
FRONTEND_BLOCK
fi)

#### Track 3: Integration & Quality Assurance
1. **Integration Testing**:
   $(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "   - BatchTool: Run parallel integration test suites"; else echo "   - Bash: Run integration test suites"; fi)
   - Bash: Execute performance benchmarks
   - Bash: Run security scans and audits
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'test: complete integration testing with performance and security validation'"; fi)

2. **Quality Gates**:
   $(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "   - BatchTool: Run parallel quality checks (linting, analysis, documentation)"; else echo "   - Bash: Run comprehensive linting and code quality analysis"; fi)
   - Bash: Validate documentation completeness
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'quality: pass all quality gates - linting, analysis, and documentation'"; fi)

### $(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "Parallel"; else echo "Sequential"; fi) Subtask Orchestration:
$(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "Use BatchTool to execute independent development tracks in parallel where possible."; else echo "Execute development tracks sequentially for thorough validation."; fi)

## COMPLETION PHASE
### Final Integration & Deployment for ${DEVELOPMENT_MODE}:
1. **System Integration**:
   - Integrate all development tracks
   $(if [[ "$SKIP_TESTS" != true ]]; then echo "   - Run comprehensive end-to-end tests"; fi)
   - Validate against original requirements
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'feat: complete system integration with full validation'"; fi)

2. **Documentation & Deployment**:
   $(if [[ "$DEVELOPMENT_MODE" == "api-only" || "$DEVELOPMENT_MODE" == "backend-only" || "$DEVELOPMENT_MODE" == "full" ]]; then echo "   - Generate comprehensive API documentation"; fi)
   - Create deployment guides and runbooks
   - Setup monitoring and alerting
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'docs: complete documentation and deployment preparation'"; fi)

3. **Production Readiness**:
   - Execute production deployment checklist
   - Validate monitoring and observability
   - Conduct final security review
   $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "   - **Commit**: 'deploy: production-ready release with full monitoring and security validation'"; fi)

## SPARC METHODOLOGY ENFORCEMENT
### Quality Standards:
- **Modularity**: All files ≤ 500 lines, functions ≤ 50 lines
- **Security**: No hardcoded secrets, comprehensive input validation
$(if [[ "$SKIP_TESTS" != true ]]; then echo "- **Testing**: ${TEST_COVERAGE_TARGET}% test coverage with TDD London School approach"; fi)
- **Documentation**: Self-documenting code with strategic comments
- **Performance**: Optimized critical paths with benchmarking

### Tool Utilization Strategy:
$(if [[ "$SKIP_RESEARCH" != true ]]; then echo "- **WebFetchTool**: Comprehensive research and documentation gathering"; fi)
$(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "- **BatchTool**: Parallel research, testing, and quality checks"; fi)
- **Bash**: Git operations, CI/CD, testing, and deployment
- **Edit/Replace**: Code implementation and refactoring
- **GlobTool/GrepTool**: Code analysis and pattern detection
$(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "- **dispatch_agent**: Complex subtask delegation"; fi)

### Commit Standards (Frequency: ${COMMIT_FREQUENCY}):
- **feat**: New features and major functionality
$(if [[ "$SKIP_TESTS" != true ]]; then echo "- **test**: Test implementation and coverage improvements"; fi)
- **fix**: Bug fixes and issue resolution
- **docs**: Documentation updates and improvements
- **arch**: Architectural changes and design updates
- **quality**: Code quality improvements and refactoring
- **deploy**: Deployment and infrastructure changes

### $(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "Parallel"; else echo "Sequential"; fi) Execution Strategy:
$(if [[ "$PARALLEL_EXECUTION" == true ]]; then cat << 'PARALLEL_BLOCK'
1. Use BatchTool for independent operations
2. Leverage dispatch_agent for complex subtasks
3. Implement concurrent development tracks
4. Optimize for maximum development velocity
PARALLEL_BLOCK
else cat << 'SEQUENTIAL_BLOCK'
1. Execute operations sequentially for thorough validation
2. Focus on quality over speed
3. Ensure each step is fully validated before proceeding
4. Maintain clear development progression
SEQUENTIAL_BLOCK
fi)

### Continuous Integration:
$(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "- Commit after each $(if [[ "$COMMIT_FREQUENCY" == "phase" ]]; then echo "major phase"; else echo "feature"; fi) completion"; fi)
$(if [[ "$SKIP_TESTS" != true ]]; then echo "- Run automated tests on every commit"; fi)
- Validate quality gates continuously
- Monitor performance and security metrics

## SUCCESS CRITERIA:
$(if [[ "$SKIP_TESTS" != true ]]; then echo "- ✅ ${TEST_COVERAGE_TARGET}% test coverage achieved"; fi)
- ✅ All quality gates passed
- ✅ Production deployment successful
- ✅ Comprehensive documentation complete
- ✅ Security and performance validated
- ✅ Monitoring and observability operational

Continue development until all success criteria are met. $(if [[ "$PARALLEL_EXECUTION" == true ]]; then echo "Use parallel execution and subtask orchestration for maximum efficiency."; fi) $(if [[ "$COMMIT_FREQUENCY" != "manual" ]]; then echo "Commit after each $(if [[ "$COMMIT_FREQUENCY" == "phase" ]]; then echo "phase"; else echo "feature"; fi) with detailed messages."; fi) Display '<SPARC-COMPLETE>' when the entire development lifecycle is finished.
" \
  --allowedTools "$allowed_tools" \
  $claude_flags
}

# Execute main function with all arguments
main "$@"
