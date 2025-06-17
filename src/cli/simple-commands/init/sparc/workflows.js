// workflows.js - SPARC workflow templates

export function createBasicSparcWorkflow() {
  return JSON.stringify({
    "name": "Basic TDD Workflow",
    "description": "A simple SPARC-based TDD workflow for development",
    "sequential": true,
    "steps": [
      {
        "mode": "spec-pseudocode",
        "description": "Create detailed specifications and pseudocode",
        "phase": "specification"
      },
      {
        "mode": "tdd", 
        "description": "Write failing tests (Red phase)",
        "phase": "red"
      },
      {
        "mode": "code",
        "description": "Implement minimal code to pass tests (Green phase)", 
        "phase": "green"
      },
      {
        "mode": "tdd",
        "description": "Refactor and optimize (Refactor phase)",
        "phase": "refactor"
      },
      {
        "mode": "integration",
        "description": "Integrate and verify complete solution",
        "phase": "integration"
      }
    ]
  }, null, 2);
}