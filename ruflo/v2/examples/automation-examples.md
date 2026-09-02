# Claude Flow Automation Examples

This document provides practical examples of using Claude Flow's automation features.

## Quick Start Examples

### 1. Basic MLE-STAR Workflow

```bash
# Simple ML engineering workflow
claude-flow automation mle-star \
  --dataset data/house_prices.csv \
  --target price \
  --claude \
  --name "house-price-prediction"
```

This will:
1. Search web for house price prediction approaches
2. Analyze your dataset characteristics
3. Build foundation models based on research
4. Perform ablation analysis to identify high-impact components
5. Refine the most impactful components
6. Create intelligent ensemble models
7. Validate with comprehensive testing
8. Prepare for production deployment

### 2. Custom Dataset with Advanced Options

```bash
# Advanced ML workflow with custom configuration
claude-flow automation mle-star \
  --dataset sales_data.csv \
  --target quarterly_revenue \
  --output models/sales-forecast/ \
  --name "q4-sales-forecast" \
  --search-iterations 5 \
  --refinement-iterations 8 \
  --max-agents 8 \
  --claude \
  --non-interactive
```

### 3. CI/CD Integration

```bash
# Use in CI/CD pipeline
export DATASET_PATH="data/production_data.csv"
export TARGET_COLUMN="conversion_rate"
export BUILD_ID="build-$(date +%Y%m%d-%H%M%S)"

claude-flow automation mle-star \
  --dataset "$DATASET_PATH" \
  --target "$TARGET_COLUMN" \
  --name "$BUILD_ID-model" \
  --output "artifacts/models/" \
  --claude \
  --non-interactive \
  --timeout 14400000  # 4 hours
```

## Custom Workflow Examples

### Example 1: Web Application Development

Create `web-app-workflow.json`:

```json
{
  "name": "Full-Stack Web Application",
  "version": "1.0.0",
  "description": "Complete web application development workflow",
  "variables": {
    "app_name": "my-web-app",
    "database": "postgresql",
    "framework": "react"
  },
  "agents": [
    {
      "id": "architect",
      "type": "architect",
      "name": "System Architect",
      "config": {
        "capabilities": ["system_design", "architecture_planning", "technology_selection"],
        "focus": "scalable_web_applications"
      }
    },
    {
      "id": "backend_dev",
      "type": "coder",
      "name": "Backend Developer", 
      "config": {
        "capabilities": ["api_development", "database_design", "server_configuration"],
        "languages": ["python", "javascript", "sql"],
        "frameworks": ["fastapi", "express", "django"]
      }
    },
    {
      "id": "frontend_dev",
      "type": "coder",
      "name": "Frontend Developer",
      "config": {
        "capabilities": ["ui_development", "responsive_design", "state_management"],
        "languages": ["javascript", "typescript", "css"],
        "frameworks": ["react", "vue", "angular"]
      }
    },
    {
      "id": "tester",
      "type": "tester",
      "name": "QA Engineer",
      "config": {
        "capabilities": ["unit_testing", "integration_testing", "e2e_testing"],
        "tools": ["jest", "cypress", "playwright"]
      }
    }
  ],
  "tasks": [
    {
      "id": "system_design",
      "name": "System Architecture Design",
      "type": "planning",
      "description": "Design overall system architecture and technology stack",
      "assignTo": "architect",
      "timeout": 1800,
      "input": {
        "requirements": "Build scalable web application with ${framework} frontend and ${database} database"
      },
      "output": {
        "architecture_diagram": "object",
        "technology_stack": "object",
        "deployment_plan": "object"
      }
    },
    {
      "id": "database_setup",
      "name": "Database Design and Setup",
      "type": "implementation",
      "description": "Create database schema and setup scripts",
      "assignTo": "backend_dev",
      "depends": ["system_design"],
      "timeout": 1200,
      "input": {
        "architecture": "${system_design.output.architecture_diagram}",
        "database_type": "${database}"
      }
    },
    {
      "id": "api_development",
      "name": "REST API Development",
      "type": "implementation",
      "description": "Develop REST API endpoints and business logic",
      "assignTo": "backend_dev",
      "depends": ["database_setup"],
      "timeout": 2400,
      "input": {
        "database_schema": "${database_setup.output}",
        "api_requirements": "${system_design.output.api_specification}"
      }
    },
    {
      "id": "frontend_development",
      "name": "Frontend Application Development", 
      "type": "implementation",
      "description": "Build responsive frontend application",
      "assignTo": "frontend_dev",
      "depends": ["api_development"],
      "timeout": 2400,
      "input": {
        "api_endpoints": "${api_development.output}",
        "ui_framework": "${framework}"
      }
    },
    {
      "id": "testing_suite",
      "name": "Comprehensive Testing Suite",
      "type": "testing",
      "description": "Create unit, integration, and e2e tests",
      "assignTo": "tester",
      "depends": ["frontend_development"],
      "timeout": 1800,
      "input": {
        "application_code": "${frontend_development.output}",
        "api_code": "${api_development.output}"
      }
    },
    {
      "id": "deployment_prep",
      "name": "Production Deployment Preparation",
      "type": "deployment",
      "description": "Prepare application for production deployment",
      "assignTo": "architect",
      "depends": ["testing_suite"],
      "timeout": 900,
      "input": {
        "tested_application": "${testing_suite.output}",
        "deployment_plan": "${system_design.output.deployment_plan}"
      }
    }
  ],
  "settings": {
    "maxConcurrency": 2,
    "timeout": 14400,
    "failurePolicy": "continue",
    "quality_threshold": 0.9
  }
}
```

Execute the workflow:

```bash
claude-flow automation run-workflow web-app-workflow.json \
  --claude \
  --variables '{"app_name": "ecommerce-platform", "database": "postgresql", "framework": "react"}' \
  --non-interactive
```

### Example 2: Data Science Research Project

Create `research-workflow.json`:

```json
{
  "name": "Data Science Research Project",
  "version": "1.0.0",
  "description": "Comprehensive data science research workflow",
  "variables": {
    "research_topic": "customer_churn_prediction",
    "data_source": "customer_database",
    "output_format": "research_paper"
  },
  "agents": [
    {
      "id": "literature_researcher",
      "type": "researcher",
      "name": "Literature Review Specialist",
      "config": {
        "capabilities": ["academic_search", "paper_analysis", "trend_identification"],
        "search_databases": ["arxiv", "google_scholar", "pubmed"]
      }
    },
    {
      "id": "data_analyst",
      "type": "analyst",
      "name": "Data Analysis Expert",
      "config": {
        "capabilities": ["statistical_analysis", "data_visualization", "pattern_recognition"],
        "tools": ["python", "r", "sql", "tableau"]
      }
    },
    {
      "id": "ml_engineer",
      "type": "coder",
      "name": "ML Model Developer",
      "config": {
        "capabilities": ["model_development", "feature_engineering", "hyperparameter_tuning"],
        "frameworks": ["scikit-learn", "tensorflow", "pytorch", "xgboost"]
      }
    },
    {
      "id": "research_writer",
      "type": "coordinator",
      "name": "Research Documentation Specialist",
      "config": {
        "capabilities": ["technical_writing", "research_synthesis", "visualization"]
      }
    }
  ],
  "tasks": [
    {
      "id": "literature_review",
      "name": "Comprehensive Literature Review",
      "type": "research",
      "description": "Review existing research on customer churn prediction methods",
      "assignTo": "literature_researcher",
      "timeout": 2400,
      "input": {
        "topic": "${research_topic}",
        "focus_areas": ["machine_learning", "customer_analytics", "predictive_modeling"]
      }
    },
    {
      "id": "data_exploration",
      "name": "Exploratory Data Analysis",
      "type": "analysis",
      "description": "Perform comprehensive EDA on customer data",
      "assignTo": "data_analyst",
      "depends": ["literature_review"],
      "timeout": 1800,
      "input": {
        "data_source": "${data_source}",
        "research_insights": "${literature_review.output}"
      }
    },
    {
      "id": "feature_engineering",
      "name": "Advanced Feature Engineering",
      "type": "implementation",
      "description": "Create and select optimal features based on research and EDA",
      "assignTo": "ml_engineer",
      "depends": ["data_exploration"],
      "timeout": 1800
    },
    {
      "id": "model_development",
      "name": "ML Model Development and Validation",
      "type": "implementation",
      "description": "Develop and validate multiple ML models",
      "assignTo": "ml_engineer", 
      "depends": ["feature_engineering"],
      "timeout": 3600
    },
    {
      "id": "research_synthesis",
      "name": "Research Paper Generation",
      "type": "documentation",
      "description": "Synthesize findings into comprehensive research paper",
      "assignTo": "research_writer",
      "depends": ["model_development"],
      "timeout": 2400,
      "input": {
        "literature_review": "${literature_review.output}",
        "data_analysis": "${data_exploration.output}",
        "model_results": "${model_development.output}",
        "output_format": "${output_format}"
      }
    }
  ],
  "settings": {
    "maxConcurrency": 3,
    "timeout": 18000,
    "failurePolicy": "continue"
  }
}
```

### Example 3: DevOps Infrastructure Setup

Create `devops-workflow.json`:

```json
{
  "name": "DevOps Infrastructure Setup",
  "version": "1.0.0", 
  "description": "Complete DevOps infrastructure deployment workflow",
  "variables": {
    "cloud_provider": "aws",
    "environment": "production",
    "app_name": "microservices-app"
  },
  "agents": [
    {
      "id": "infrastructure_architect",
      "type": "architect",
      "name": "Infrastructure Architect",
      "config": {
        "capabilities": ["cloud_architecture", "security_design", "cost_optimization"],
        "cloud_platforms": ["aws", "azure", "gcp"]
      }
    },
    {
      "id": "devops_engineer",
      "type": "coder",
      "name": "DevOps Engineer",
      "config": {
        "capabilities": ["infrastructure_as_code", "ci_cd_pipelines", "container_orchestration"],
        "tools": ["terraform", "ansible", "kubernetes", "docker"]
      }
    },
    {
      "id": "security_specialist",
      "type": "tester",
      "name": "Security Specialist",
      "config": {
        "capabilities": ["security_testing", "compliance_checking", "vulnerability_assessment"],
        "tools": ["nessus", "owasp_zap", "sonarqube"]
      }
    }
  ],
  "tasks": [
    {
      "id": "infrastructure_design",
      "name": "Infrastructure Architecture Design",
      "type": "planning",
      "description": "Design scalable and secure cloud infrastructure",
      "assignTo": "infrastructure_architect",
      "timeout": 1800,
      "input": {
        "cloud_provider": "${cloud_provider}",
        "environment": "${environment}",
        "requirements": "High availability, auto-scaling, security"
      }
    },
    {
      "id": "terraform_implementation",
      "name": "Infrastructure as Code Implementation",
      "type": "implementation",
      "description": "Implement infrastructure using Terraform",
      "assignTo": "devops_engineer",
      "depends": ["infrastructure_design"],
      "timeout": 2400
    },
    {
      "id": "ci_cd_setup",
      "name": "CI/CD Pipeline Setup",
      "type": "implementation",
      "description": "Create comprehensive CI/CD pipelines",
      "assignTo": "devops_engineer",
      "depends": ["terraform_implementation"],
      "timeout": 1800
    },
    {
      "id": "security_hardening",
      "name": "Security Hardening and Testing",
      "type": "testing",
      "description": "Implement security measures and conduct testing",
      "assignTo": "security_specialist",
      "depends": ["ci_cd_setup"],
      "timeout": 2400
    },
    {
      "id": "monitoring_setup",
      "name": "Monitoring and Alerting Setup",
      "type": "implementation",
      "description": "Setup comprehensive monitoring and alerting",
      "assignTo": "devops_engineer",
      "depends": ["security_hardening"],
      "timeout": 1200
    }
  ],
  "settings": {
    "maxConcurrency": 2,
    "timeout": 14400,
    "failurePolicy": "fail-fast"
  }
}
```

## Advanced Usage Patterns

### 1. Multi-Environment Deployment

```bash
# Development environment
claude-flow automation run-workflow devops-workflow.json \
  --variables '{"cloud_provider": "aws", "environment": "development"}' \
  --claude

# Production environment  
claude-flow automation run-workflow devops-workflow.json \
  --variables '{"cloud_provider": "aws", "environment": "production"}' \
  --claude \
  --non-interactive
```

### 2. Conditional Execution

Add conditions to tasks:

```json
{
  "id": "deploy_to_production",
  "condition": "${test_results.success} && ${security_scan.score} > 0.8",
  "description": "Deploy only if tests pass and security score is high"
}
```

### 3. Dynamic Agent Scaling

Adjust agents based on workload:

```bash
# Light workload
claude-flow automation mle-star --max-agents 3 --claude

# Heavy workload
claude-flow automation mle-star --max-agents 12 --claude
```

## Integration Examples

### 1. GitHub Actions Integration

`.github/workflows/ml-pipeline.yml`:

```yaml
name: ML Pipeline
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  ml-training:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install Claude Flow
        run: npm install -g claude-flow@alpha
        
      - name: Run MLE-STAR Pipeline
        run: |
          claude-flow automation mle-star \
            --dataset data/training_data.csv \
            --target conversion_rate \
            --name "github-action-${{ github.run_id }}" \
            --output artifacts/models/ \
            --non-interactive \
            --timeout 7200000
            
      - name: Upload Model Artifacts
        uses: actions/upload-artifact@v3
        with:
          name: ml-models
          path: artifacts/models/
```

### 2. Docker Integration

`Dockerfile`:

```dockerfile
FROM node:20-alpine

RUN npm install -g claude-flow@alpha

WORKDIR /app
COPY . .

CMD ["claude-flow", "automation", "mle-star", \
     "--dataset", "/data/dataset.csv", \
     "--non-interactive", \
     "--output", "/models/"]
```

### 3. Kubernetes Job

`ml-job.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ml-training-job
spec:
  template:
    spec:
      containers:
      - name: ml-trainer
        image: claude-flow:latest
        command: ["claude-flow", "automation", "mle-star"]
        args:
          - "--dataset"
          - "/data/dataset.csv"
          - "--non-interactive"
          - "--timeout"
          - "14400000"
        volumeMounts:
        - name: data-volume
          mountPath: /data
        - name: models-volume
          mountPath: /models
      restartPolicy: Never
      volumes:
      - name: data-volume
        persistentVolumeClaim:
          claimName: training-data-pvc
      - name: models-volume
        persistentVolumeClaim:
          claimName: models-pvc
```

## Troubleshooting Examples

### 1. Debug Mode

```bash
# Enable verbose logging
claude-flow automation mle-star \
  --dataset data/debug.csv \
  --verbose \
  --claude \
  --timeout 1800000
```

### 2. Workflow Validation

```bash
# Test workflow syntax without execution
claude-flow automation run-workflow my-workflow.json \
  --output-format json \
  --timeout 5000  # Short timeout for validation
```

### 3. Step-by-Step Execution

Break complex workflows into smaller pieces for debugging:

```json
{
  "name": "Debug Workflow - Step 1",
  "tasks": [
    {
      "id": "data_analysis_only",
      "name": "Just Data Analysis",
      "description": "Test data analysis step in isolation"
    }
  ]
}
```

## Performance Optimization Examples

### 1. Parallel Task Execution

```json
{
  "tasks": [
    {
      "id": "task_a",
      "description": "Independent task A"
    },
    {
      "id": "task_b", 
      "description": "Independent task B"
    },
    {
      "id": "task_c",
      "depends": ["task_a", "task_b"],
      "description": "Task C depends on A and B"
    }
  ],
  "settings": {
    "maxConcurrency": 3  // Run A and B in parallel
  }
}
```

### 2. Resource-Aware Configuration

```json
{
  "settings": {
    "maxConcurrency": 2,  // Conservative for limited resources
    "timeout": 7200,      // 2 hours
    "quality_threshold": 0.85
  },
  "agents": [
    {
      "config": {
        "resource_requirements": {
          "memory": "4GB",
          "cpu_cores": 2
        }
      }
    }
  ]
}
```

## Best Practices Examples

### 1. Environment-Specific Configurations

```bash
# Development
claude-flow automation run-workflow workflow.json \
  --variables '{"timeout": 1800, "quality_threshold": 0.7}'

# Production  
claude-flow automation run-workflow workflow.json \
  --variables '{"timeout": 7200, "quality_threshold": 0.95}'
```

### 2. Error Recovery Patterns

```json
{
  "tasks": [
    {
      "id": "critical_task",
      "retries": 3,
      "timeout": 3600,
      "fallback_task": "manual_intervention"
    }
  ],
  "settings": {
    "failurePolicy": "continue",
    "enable_monitoring": true
  }
}
```

### 3. Monitoring and Alerting

```json
{
  "settings": {
    "enable_monitoring": true,
    "alert_conditions": {
      "execution_time": "> 2 hours",
      "failure_rate": "> 10%",
      "resource_usage": "> 80%"
    }
  }
}
```

These examples demonstrate the full power and flexibility of Claude Flow's automation system. Start with simple examples and gradually build more complex workflows as you become familiar with the system.