/**
 * Web Application Template
 * A comprehensive template for building modern web applications
 */

import { TaskTemplate, TemplateCategory, VariableType } from '../types/template-types.ts';
import { TaskMasterStatus, TaskMasterPriority, SPARCPhase } from '../../types/task-types.ts';

export const webAppTemplate: TaskTemplate = {
  id: 'web-app-template',
  name: 'Modern Web Application',
  description: 'Complete template for building a modern web application with frontend, backend, and database',
  category: TemplateCategory.WEB_DEVELOPMENT,
  version: '1.0.0',
  author: 'TaskMaster Team',
  tags: ['web', 'fullstack', 'react', 'node', 'database'],
  metadata: {
    icon: '🌐',
    color: '#3498db',
    estimatedHours: 80,
    complexity: 'high'
  },
  variables: [
    {
      name: 'appName',
      type: VariableType.STRING,
      description: 'Name of the application',
      required: true,
      validation: {
        pattern: '^[a-zA-Z0-9-_]+$'
      }
    },
    {
      name: 'framework',
      type: VariableType.ENUM,
      description: 'Frontend framework to use',
      required: true,
      options: ['React', 'Vue', 'Angular', 'Svelte'],
      default: 'React'
    },
    {
      name: 'backend',
      type: VariableType.ENUM,
      description: 'Backend technology',
      required: true,
      options: ['Node.ts', 'Python', 'Go', 'Java'],
      default: 'Node.ts'
    },
    {
      name: 'database',
      type: VariableType.ENUM,
      description: 'Database type',
      required: true,
      options: ['PostgreSQL', 'MySQL', 'MongoDB', 'SQLite'],
      default: 'PostgreSQL'
    },
    {
      name: 'includeAuth',
      type: VariableType.BOOLEAN,
      description: 'Include authentication system',
      required: false,
      default: true
    },
    {
      name: 'includeTests',
      type: VariableType.BOOLEAN,
      description: 'Include comprehensive test suite',
      required: false,
      default: true
    }
  ],
  tasks: [
    // Specification Phase
    {
      id: 'spec-1',
      title: 'Define ${appName} Requirements',
      description: 'Create detailed functional and non-functional requirements for ${appName}',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      tags: ['specification', 'planning'],
      sparcPhase: SPARCPhase.SPECIFICATION
    },
    {
      id: 'spec-2',
      title: 'Create User Stories and Use Cases',
      description: 'Document user stories and use cases for all features',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['spec-1'],
      tags: ['specification', 'documentation'],
      sparcPhase: SPARCPhase.SPECIFICATION
    },

    // Architecture Phase
    {
      id: 'arch-1',
      title: 'Design System Architecture',
      description: 'Create high-level architecture using ${framework} and ${backend}',
      priority: TaskMasterPriority.HIGH,
      estimate: 6,
      dependencies: ['spec-2'],
      tags: ['architecture', 'design'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },
    {
      id: 'arch-2',
      title: 'Design ${database} Schema',
      description: 'Create database schema and data models',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['arch-1'],
      tags: ['database', 'architecture'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },
    {
      id: 'arch-3',
      title: 'Design API Endpoints',
      description: 'Define RESTful API endpoints and contracts',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['arch-2'],
      tags: ['api', 'architecture'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },

    // Implementation Phase - Backend
    {
      id: 'impl-backend-1',
      title: 'Setup ${backend} Project Structure',
      description: 'Initialize backend project with ${backend} and necessary dependencies',
      priority: TaskMasterPriority.HIGH,
      estimate: 2,
      dependencies: ['arch-3'],
      tags: ['backend', 'setup'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-backend-2',
      title: 'Implement ${database} Connection',
      description: 'Setup database connection and ORM/ODM',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['impl-backend-1'],
      tags: ['backend', 'database'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-backend-3',
      title: 'Create Data Models',
      description: 'Implement data models and schemas',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['impl-backend-2'],
      tags: ['backend', 'models'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-backend-4',
      title: 'Implement API Endpoints',
      description: 'Create all API endpoints with proper validation',
      priority: TaskMasterPriority.HIGH,
      estimate: 8,
      dependencies: ['impl-backend-3'],
      tags: ['backend', 'api'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Implementation Phase - Frontend
    {
      id: 'impl-frontend-1',
      title: 'Setup ${framework} Project',
      description: 'Initialize ${framework} project with routing and state management',
      priority: TaskMasterPriority.HIGH,
      estimate: 2,
      dependencies: ['arch-3'],
      tags: ['frontend', 'setup'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-frontend-2',
      title: 'Create Component Library',
      description: 'Build reusable UI components',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 6,
      dependencies: ['impl-frontend-1'],
      tags: ['frontend', 'ui'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-frontend-3',
      title: 'Implement Application Routes',
      description: 'Create all application pages and routes',
      priority: TaskMasterPriority.HIGH,
      estimate: 8,
      dependencies: ['impl-frontend-2'],
      tags: ['frontend', 'routing'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-frontend-4',
      title: 'Integrate with Backend API',
      description: 'Connect frontend with backend services',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['impl-frontend-3', 'impl-backend-4'],
      tags: ['frontend', 'integration'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Authentication (conditional)
    {
      id: 'auth-1',
      title: 'Implement Authentication System',
      description: 'Add user authentication with JWT tokens',
      priority: TaskMasterPriority.HIGH,
      estimate: 6,
      dependencies: ['impl-backend-3'],
      tags: ['authentication', 'security'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeAuth'
      }
    },
    {
      id: 'auth-2',
      title: 'Create Login/Signup UI',
      description: 'Build authentication UI components',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['impl-frontend-2', 'auth-1'],
      tags: ['frontend', 'authentication'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeAuth'
      }
    },

    // Testing (conditional)
    {
      id: 'test-1',
      title: 'Write Unit Tests',
      description: 'Create unit tests for all components and services',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 8,
      dependencies: ['impl-frontend-4'],
      tags: ['testing', 'quality'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeTests'
      }
    },
    {
      id: 'test-2',
      title: 'Write Integration Tests',
      description: 'Create integration tests for API endpoints',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 6,
      dependencies: ['impl-backend-4'],
      tags: ['testing', 'api'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeTests'
      }
    },
    {
      id: 'test-3',
      title: 'Write E2E Tests',
      description: 'Create end-to-end tests for critical user flows',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 6,
      dependencies: ['impl-frontend-4'],
      tags: ['testing', 'e2e'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeTests'
      }
    },

    // Completion Phase
    {
      id: 'complete-1',
      title: 'Performance Optimization',
      description: 'Optimize application performance and bundle size',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 4,
      dependencies: ['impl-frontend-4', 'impl-backend-4'],
      tags: ['optimization', 'performance'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-2',
      title: 'Security Audit',
      description: 'Perform security audit and fix vulnerabilities',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['complete-1'],
      tags: ['security', 'audit'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-3',
      title: 'Documentation',
      description: 'Create comprehensive documentation',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 6,
      dependencies: ['complete-1'],
      tags: ['documentation'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-4',
      title: 'Deployment Setup',
      description: 'Configure deployment pipeline and environments',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['complete-2'],
      tags: ['deployment', 'devops'],
      sparcPhase: SPARCPhase.COMPLETION
    }
  ],
  createdAt: new Date(),
  updatedAt: new Date()
};