#!/usr/bin/env python3
"""
Simple SPARC benchmark example using Specification, Pseudocode, Architecture, Refinement, Completion.

This example demonstrates:
- SPARC methodology implementation
- TDD (Test-Driven Development) integration
- Progressive refinement tracking
- Quality assurance metrics
"""

import subprocess
import sys
import json
from pathlib import Path

def run_sparc_benchmark():
    """Run a simple SPARC methodology benchmark."""
    print("⚡ Starting Simple SPARC Benchmark")
    print("=" * 45)
    
    # Example 1: CLI with SPARC mode
    print("\n📋 Method 1: CLI with SPARC TDD Mode")
    cmd = [
        "swarm-benchmark", "real", "sparc",
        "Create a user authentication system",
        "--mode", "tdd",
        "--agents", "4",
        "--refinement-cycles", "3"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd="/workspaces/claude-code-flow/benchmark")
        if result.returncode == 0:
            print(f"✅ SPARC CLI execution successful")
            print(f"⚡ SPARC output: {result.stdout[:200]}...")
        else:
            print(f"❌ CLI execution failed: {result.stderr}")
    except Exception as e:
        print(f"⚠️  CLI execution error: {e}")
    
    # Example 2: Python API with SPARC workflow
    print("\n📋 Method 2: Python API with SPARC Workflow")
    try:
        from swarm_benchmark.modes import SparcMode
        
        # Initialize SPARC coordinator
        sparc_coordinator = SparcMode(
            refinement_cycles=3,
            enable_tdd=True,
            quality_gates=True
        )
        
        # Configure SPARC task
        sparc_config = {
            "specification": "User authentication with JWT tokens",
            "architecture_style": "microservices",
            "testing_strategy": "unit_and_integration",
            "completion_threshold": 0.95
        }
        
        # Execute SPARC workflow
        result = sparc_coordinator.execute_sparc_cycle(**sparc_config)
        
        print(f"✅ SPARC workflow execution successful")
        print(f"📐 Architecture completeness: {result.get('architecture_score', 0):.2f}")
        print(f"🧪 Test coverage: {result.get('test_coverage', 0):.2f}")
        
    except ImportError:
        print("⚠️  SPARC components not available")
        demonstrate_mock_sparc_workflow()
    except Exception as e:
        print(f"❌ SPARC workflow error: {e}")

def demonstrate_mock_sparc_workflow():
    """Demonstrate SPARC methodology steps."""
    print("\n⚡ Mock SPARC Workflow Demo")
    print("=" * 30)
    
    # SPARC phases
    sparc_phases = {
        "Specification": {
            "description": "Define clear requirements and constraints",
            "deliverables": ["Requirements doc", "User stories", "Acceptance criteria"],
            "completion": 0.85
        },
        "Pseudocode": {
            "description": "High-level algorithm design",
            "deliverables": ["Algorithm outline", "Data structures", "Flow diagrams"],
            "completion": 0.78
        },
        "Architecture": {
            "description": "System design and component architecture",
            "deliverables": ["Architecture diagram", "Component interfaces", "Technology stack"],
            "completion": 0.92
        },
        "Refinement": {
            "description": "Iterative improvement and optimization",
            "deliverables": ["Code refinements", "Performance improvements", "Security hardening"],
            "completion": 0.88
        },
        "Completion": {
            "description": "Final implementation and validation",
            "deliverables": ["Production code", "Test suite", "Documentation"],
            "completion": 0.91
        }
    }
    
    print("SPARC Phase Progress:")
    total_completion = 0
    for phase, details in sparc_phases.items():
        completion = details["completion"]
        total_completion += completion
        status = "✅" if completion > 0.8 else "🟡" if completion > 0.6 else "❌"
        print(f"  {status} {phase}: {completion:.1%}")
        print(f"     📋 {details['description']}")
        print(f"     📦 Deliverables: {len(details['deliverables'])} items")
    
    overall_completion = total_completion / len(sparc_phases)
    print(f"\n🎯 Overall SPARC Completion: {overall_completion:.1%}")
    
    return {
        "sparc_completion": overall_completion,
        "phases_completed": sum(1 for p in sparc_phases.values() if p["completion"] > 0.8),
        "total_phases": len(sparc_phases)
    }

def demonstrate_tdd_integration():
    """Show TDD integration with SPARC."""
    print("\n🧪 TDD Integration with SPARC")
    print("=" * 32)
    
    tdd_cycle = {
        "Red": {
            "description": "Write failing tests first",
            "sparc_phase": "Specification",
            "deliverables": ["Test specifications", "Failure scenarios"]
        },
        "Green": {
            "description": "Implement minimal code to pass tests",
            "sparc_phase": "Pseudocode + Architecture",
            "deliverables": ["Basic implementation", "Passing tests"]
        },
        "Refactor": {
            "description": "Improve code quality while maintaining tests",
            "sparc_phase": "Refinement",
            "deliverables": ["Clean code", "Optimized performance"]
        }
    }
    
    print("TDD Cycle Integration:")
    for cycle, details in tdd_cycle.items():
        print(f"  🔴🟢🔵 {cycle}:")
        print(f"     📝 {details['description']}")
        print(f"     ⚡ SPARC Phase: {details['sparc_phase']}")
        print(f"     📦 Outputs: {', '.join(details['deliverables'])}")
    
    # Example test metrics
    test_metrics = {
        "test_count": 24,
        "test_coverage": 0.87,
        "passing_tests": 22,
        "failing_tests": 2,
        "code_quality_score": 8.5,
        "technical_debt_ratio": 0.15
    }
    
    print(f"\n📊 TDD Metrics:")
    print(f"  🧪 Total Tests: {test_metrics['test_count']}")
    print(f"  📈 Coverage: {test_metrics['test_coverage']:.1%}")
    print(f"  ✅ Passing: {test_metrics['passing_tests']}")
    print(f"  ❌ Failing: {test_metrics['failing_tests']}")
    print(f"  🎯 Quality Score: {test_metrics['code_quality_score']}/10")

def collect_sparc_metrics():
    """Collect and save SPARC-specific metrics."""
    print("\n📊 SPARC Metrics Collection")
    print("=" * 28)
    
    # Sample SPARC metrics
    sparc_metrics = {
        "benchmark_id": "simple-sparc-demo",
        "execution_time": 78.5,
        "agents_count": 4,
        "methodology": "SPARC",
        "tdd_enabled": True,
        "refinement_cycles": 3,
        "specification_completeness": 0.85,
        "pseudocode_clarity": 0.78,
        "architecture_score": 0.92,
        "refinement_iterations": 2,
        "completion_quality": 0.91,
        "test_coverage": 0.87,
        "code_quality_score": 8.5,
        "technical_debt_ratio": 0.15,
        "time_per_phase": {
            "specification": 12.3,
            "pseudocode": 15.7,
            "architecture": 18.9,
            "refinement": 21.4,
            "completion": 10.2
        }
    }
    
    print("SPARC methodology metrics:")
    print(json.dumps(sparc_metrics, indent=2))
    
    # Save metrics
    output_dir = Path("/workspaces/claude-code-flow/benchmark/examples/output")
    output_dir.mkdir(exist_ok=True)
    
    with open(output_dir / "simple_sparc_metrics.json", "w") as f:
        json.dump(sparc_metrics, f, indent=2)
    
    print(f"📁 SPARC metrics saved to: {output_dir / 'simple_sparc_metrics.json'}")

if __name__ == "__main__":
    run_sparc_benchmark()
    sparc_result = demonstrate_mock_sparc_workflow()
    demonstrate_tdd_integration()
    collect_sparc_metrics()
    
    print("\n⚡ Simple SPARC Benchmark Complete!")
    print(f"🎯 SPARC completion rate: {sparc_result['sparc_completion']:.1%}")
    print(f"✅ Phases completed: {sparc_result['phases_completed']}/{sparc_result['total_phases']}")
    print("\nNext steps:")
    print("- Try advanced SPARC patterns in ../advanced/")
    print("- Run real TDD benchmarks in ../real/")
    print("- Compare with other development methodologies")