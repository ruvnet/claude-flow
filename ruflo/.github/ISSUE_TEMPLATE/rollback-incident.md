---
name: 🔄 Rollback Incident Report
about: Report an incident that requires or resulted from a rollback
title: '🔄 Rollback Incident: [Brief Description]'
labels: ['rollback', 'incident', 'high-priority']
assignees: []
---

## 🔄 Rollback Incident Details

### Incident Summary
- **Incident Type:** <!-- Manual Rollback / Automated Rollback / Rollback Failure -->
- **Severity:** <!-- Critical / High / Medium / Low -->
- **Status:** <!-- Active / Investigating / Resolved -->
- **Detected At:** <!-- YYYY-MM-DD HH:MM UTC -->

### Rollback Information
- **Rollback Session ID:** <!-- From workflow logs -->
- **Source Commit:** <!-- SHA of problematic commit -->
- **Target Commit:** <!-- SHA of rollback target -->
- **Rollback Reason:** <!-- Brief description -->

### Impact Assessment
- [ ] Production services affected
- [ ] User-facing functionality impacted
- [ ] Data integrity concerns
- [ ] Performance degradation
- [ ] Security implications

**Affected Components:**
- <!-- List affected services/components -->

**Estimated User Impact:**
- **Users Affected:** <!-- Number or percentage -->
- **Duration:** <!-- How long was the impact -->

### Timeline
<!-- Provide a timeline of events -->

**Detection:**
- <!-- When was the issue first detected -->

**Rollback Execution:**
- <!-- When was rollback initiated and completed -->

**Resolution:**
- <!-- When was normal service restored -->

### Root Cause Analysis
<!-- What caused the original failure that required rollback -->

**Contributing Factors:**
- <!-- List factors that led to the incident -->

**Failure Points:**
- <!-- Identify where systems failed to prevent this -->

### Resolution Actions
<!-- What was done to resolve the incident -->

- [ ] Automated rollback executed successfully
- [ ] Manual intervention required
- [ ] Database rollback performed
- [ ] Configuration restored
- [ ] Monitoring alerts configured

### Prevention Measures
<!-- What will be done to prevent similar incidents -->

**Immediate Actions:**
- [ ] <!-- Immediate steps taken -->

**Long-term Improvements:**
- [ ] <!-- Process/system improvements -->

### Lessons Learned
<!-- Key takeaways from this incident -->

1. <!-- Lesson 1 -->
2. <!-- Lesson 2 -->
3. <!-- Lesson 3 -->

### Follow-up Actions
<!-- Actions to be taken after incident resolution -->

- [ ] Update rollback procedures
- [ ] Improve monitoring/alerting
- [ ] Enhance testing procedures
- [ ] Update documentation
- [ ] Team training/communication

### Stakeholder Communication
<!-- How stakeholders were informed -->

- [ ] Team notified
- [ ] Management informed
- [ ] Users communicated (if applicable)
- [ ] Post-mortem scheduled

---

**Additional Notes:**
<!-- Any additional context or information -->

**Related Issues/PRs:**
<!-- Link related issues or pull requests -->

**Rollback Artifacts:**
<!-- Links to workflow runs, logs, or reports -->