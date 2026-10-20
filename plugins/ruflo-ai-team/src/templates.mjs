export const TEAM_TEMPLATES = Object.freeze([
  {
    id: 'research-brief', name: 'Research Brief',
    description: 'Collect sources, challenge the strongest claims, and produce an evidence-backed brief.',
    roles: ['coordinator', 'researcher', 'verifier'],
  },
  {
    id: 'release-readiness', name: 'Release Readiness',
    description: 'Review implementation, tests, security, documentation, and release evidence.',
    roles: ['coordinator', 'builder', 'verifier'],
  },
  {
    id: 'security-review', name: 'Security Review',
    description: 'Threat-model a change, test important abuse paths, and report prioritized findings.',
    roles: ['coordinator', 'security-reviewer', 'verifier'],
  },
]);

export const templateById = (id) => TEAM_TEMPLATES.find((template) => template.id === id);
