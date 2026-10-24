// monitoring.js - Deployment Monitor mode orchestration template
export function getMonitoringOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Monitoring Setup** (15 mins)
   - Define monitoring scope: "${taskDescription}"
   - Identify key metrics
   - Set up logging infrastructure
   - Configure alerting rules
   - Store setup: \`npx claude-flow memory store ${memoryNamespace}_monitoring_setup "..."\`

2. **Metric Collection** (20 mins)
   - Implement performance metrics
   - Add business metrics
   - Set up error tracking
   - Configure uptime monitoring
   - Store metrics: \`npx claude-flow memory store ${memoryNamespace}_metrics "..."\`

3. **Dashboard Creation** (15 mins)
   - Build monitoring dashboards
   - Create alert configurations
   - Set up automated reports
   - Document metric meanings
   - Store dashboards: \`npx claude-flow memory store ${memoryNamespace}_dashboards "..."\`

4. **Baseline Establishment** (10 mins)
   - Collect initial metrics
   - Define normal ranges
   - Set alert thresholds
   - Document SLIs/SLOs

5. **Deliverables**
   - Monitoring configuration
   - Dashboard definitions
   - Alert rules
   - Ops runbook`;
}
