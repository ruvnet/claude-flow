// devops.js - DevOps mode orchestration template
export function getDevOpsOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Environment Analysis** (10 mins)
   - Run system analysis: \`uname -a\`
   - Understand deployment requirements: "${taskDescription}"
   - Query architecture and configuration:
     \`\`\`bash
     npx claude-flow memory query ${memoryNamespace}_architecture
     npx claude-flow memory query ${memoryNamespace}_deployment
     npx claude-flow memory query ${memoryNamespace}_infrastructure
     \`\`\`
   - Identify target environments:
     - Development, staging, production
     - Cloud providers (AWS, GCP, Azure)
     - Edge platforms (Vercel, Cloudflare)
     - Container orchestration (K8s, ECS)
   - Review current infrastructure state
   - Store analysis: \`npx claude-flow memory store ${memoryNamespace}_devops_analysis "Task: ${taskDescription}. Target: AWS ECS + CloudFront. Current: Local dev only. Requirements: Auto-scaling, blue-green deployment, monitoring."\`

2. **Infrastructure Provisioning** (20 mins)
   - Set up infrastructure as code:
     - Create Terraform/CloudFormation templates
     - Define resource configurations
     - Set up networking (VPC, subnets, security groups)
   - Provision compute resources:
     - Cloud functions (Lambda, Cloud Functions)
     - Container services (ECS, GKE)
     - Edge runtimes (Workers, Functions)
   - Configure managed services:
     - Databases (RDS, DynamoDB, Firestore)
     - Caching (ElastiCache, Memorystore)
     - Message queues (SQS, Pub/Sub)
   - Set up secrets management:
     - AWS Secrets Manager / GCP Secret Manager
     - Vault integration
     - Environment injection layers
   - NEVER hardcode credentials or tokens
   - Store provisioning: \`npx claude-flow memory store ${memoryNamespace}_infrastructure "Provisioned: ECS cluster (2 AZs), RDS PostgreSQL, ElastiCache Redis, ALB. Secrets: AWS Secrets Manager configured. Terraform state: S3 backend."\`

3. **CI/CD Pipeline Setup** (15 mins)
   - Create pipeline configuration:
     - GitHub Actions / GitLab CI / Jenkins
     - Multi-stage pipeline (build, test, deploy)
     - Environment-specific deployments
   - Implement build stages:
     \`\`\`yaml
     - Build: Compile, bundle, optimize
     - Test: Unit, integration, e2e
     - Security: SAST, dependency scanning
     - Package: Docker images, artifacts
     \`\`\`
   - Configure deployment strategies:
     - Blue-green deployments
     - Canary releases
     - Rollback procedures
   - Set up quality gates:
     - Code coverage thresholds
     - Performance benchmarks
     - Security scan results
   - Store pipeline config: \`npx claude-flow memory store ${memoryNamespace}_cicd "Pipeline: GitHub Actions. Stages: build->test->security->deploy. Environments: dev (auto), staging (manual), prod (approved). Rollback: Automated on failure."\`

4. **Monitoring & Observability** (15 mins)
   - Set up application monitoring:
     - APM tools (DataDog, New Relic, AppDynamics)
     - Custom metrics and dashboards
     - Real-time alerting
   - Configure infrastructure monitoring:
     - CloudWatch / Stackdriver metrics
     - Resource utilization alerts
     - Cost optimization tracking
   - Implement logging strategy:
     - Centralized logging (ELK, CloudWatch Logs)
     - Structured logging format
     - Log retention policies
   - Set up distributed tracing:
     - Request flow tracking
     - Performance bottleneck identification
     - Error correlation
   - Configure alerting rules:
     - SLA/SLO monitoring
     - Anomaly detection
     - Escalation procedures
   - Store monitoring setup: \`npx claude-flow memory store ${memoryNamespace}_monitoring "APM: DataDog configured. Logs: CloudWatch Logs with 30-day retention. Alerts: CPU >80%, Memory >85%, Error rate >1%. Dashboards: App performance, infra health, cost tracking."\`

5. **Security & Compliance** (10 mins)
   - Implement security best practices:
     - TLS/SSL certificates (Let's Encrypt, ACM)
     - WAF rules and DDoS protection
     - Network segmentation
     - IAM roles and policies
   - Configure compliance controls:
     - Audit logging
     - Data encryption at rest/transit
     - Backup and disaster recovery
   - Set up security scanning:
     - Container image scanning
     - Infrastructure vulnerability scanning
     - Compliance policy validation
   - Document security procedures
   - Store security config: \`npx claude-flow memory store ${memoryNamespace}_devops_security "TLS: ACM certificates on ALB. WAF: OWASP rules enabled. IAM: Least privilege roles. Backups: Daily snapshots, 30-day retention. Compliance: SOC2 controls implemented."\`

## Deliverables
- infrastructure/
  - terraform/ (IaC templates, < 500 lines per file)
  - scripts/ (deployment scripts)
  - configs/ (environment configurations)
- .github/workflows/ or .gitlab-ci.yml
  - ci.yml (build and test pipeline)
  - deploy.yml (deployment pipeline)
- monitoring/
  - dashboards/ (monitoring dashboards)
  - alerts/ (alerting rules)
- docs/
  - DEPLOYMENT.md (deployment procedures)
  - RUNBOOK.md (operational runbook)
  - DISASTER_RECOVERY.md (DR procedures)
  - ROLLBACK.md (rollback instructions)

## DevOps Best Practices
- Immutable infrastructure deployments
- Blue-green deployment strategy
- Automated rollback on failures
- Never hardcode credentials - use secrets managers
- Infrastructure as Code for everything
- Comprehensive monitoring and alerting
- Regular disaster recovery testing
- Cost optimization reviews

## Next Steps
After DevOps setup:
- \`npx claude-flow sparc run post-deployment-monitoring-mode "Verify production deployment health" --non-interactive\`
- \`npx claude-flow sparc run security-review "Audit infrastructure security" --non-interactive\`
- \`npx claude-flow sparc run refinement-optimization-mode "Optimize deployment performance" --non-interactive\``;
}
