/**
 * API Service Template
 * Template for building RESTful API services
 */

import { TaskTemplate, TemplateCategory, VariableType } from '../types/template-types.ts';
import { TaskMasterStatus, TaskMasterPriority, SPARCPhase } from '../../types/task-types.ts';

export const apiServiceTemplate: TaskTemplate = {
  id: 'api-service-template',
  name: 'RESTful API Service',
  description: 'Template for building scalable RESTful API services with best practices',
  category: TemplateCategory.API_DEVELOPMENT,
  version: '1.0.0',
  author: 'TaskMaster Team',
  tags: ['api', 'rest', 'microservice', 'backend'],
  metadata: {
    icon: '🔌',
    color: '#2ecc71',
    estimatedHours: 40,
    complexity: 'medium'
  },
  variables: [
    {
      name: 'serviceName',
      type: VariableType.STRING,
      description: 'Name of the API service',
      required: true,
      validation: {
        pattern: '^[a-zA-Z0-9-_]+$'
      }
    },
    {
      name: 'language',
      type: VariableType.ENUM,
      description: 'Programming language',
      required: true,
      options: ['Node.ts', 'Python', 'Go', 'Java', 'Rust'],
      default: 'Node.ts'
    },
    {
      name: 'authType',
      type: VariableType.ENUM,
      description: 'Authentication type',
      required: true,
      options: ['JWT', 'OAuth2', 'API Key', 'Basic Auth', 'None'],
      default: 'JWT'
    },
    {
      name: 'includeDocker',
      type: VariableType.BOOLEAN,
      description: 'Include Docker configuration',
      required: false,
      default: true
    },
    {
      name: 'includeSwagger',
      type: VariableType.BOOLEAN,
      description: 'Include Swagger/OpenAPI documentation',
      required: false,
      default: true
    }
  ],
  tasks: [
    // Specification Phase
    {
      id: 'spec-1',
      title: 'Define ${serviceName} API Requirements',
      description: 'Document functional requirements and API scope',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      tags: ['specification', 'requirements'],
      sparcPhase: SPARCPhase.SPECIFICATION
    },
    {
      id: 'spec-2',
      title: 'Design API Endpoints',
      description: 'Define all API endpoints with request/response schemas',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['spec-1'],
      tags: ['specification', 'api-design'],
      sparcPhase: SPARCPhase.SPECIFICATION
    },

    // Architecture Phase
    {
      id: 'arch-1',
      title: 'Design Service Architecture',
      description: 'Create service architecture with ${language}',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['spec-2'],
      tags: ['architecture', 'design'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },
    {
      id: 'arch-2',
      title: 'Design Data Models',
      description: 'Define data models and database schema',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['arch-1'],
      tags: ['architecture', 'data-modeling'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },
    {
      id: 'arch-3',
      title: 'Design ${authType} Authentication',
      description: 'Plan authentication and authorization flow',
      priority: TaskMasterPriority.HIGH,
      estimate: 2,
      dependencies: ['arch-1'],
      tags: ['architecture', 'security'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },

    // Implementation Phase
    {
      id: 'impl-1',
      title: 'Initialize ${language} Project',
      description: 'Setup project structure and dependencies',
      priority: TaskMasterPriority.HIGH,
      estimate: 2,
      dependencies: ['arch-3'],
      tags: ['implementation', 'setup'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-2',
      title: 'Implement Core Middleware',
      description: 'Setup error handling, logging, and request validation',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['impl-1'],
      tags: ['implementation', 'middleware'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-3',
      title: 'Implement ${authType} Authentication',
      description: 'Build authentication middleware and services',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['impl-2'],
      tags: ['implementation', 'authentication'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-4',
      title: 'Implement Data Access Layer',
      description: 'Create repository pattern and database connections',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['impl-1'],
      tags: ['implementation', 'database'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-5',
      title: 'Implement API Endpoints',
      description: 'Build all API endpoints with validation',
      priority: TaskMasterPriority.HIGH,
      estimate: 8,
      dependencies: ['impl-3', 'impl-4'],
      tags: ['implementation', 'api'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Swagger Documentation (conditional)
    {
      id: 'swagger-1',
      title: 'Setup Swagger/OpenAPI',
      description: 'Configure Swagger documentation',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 2,
      dependencies: ['impl-5'],
      tags: ['documentation', 'swagger'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeSwagger'
      }
    },
    {
      id: 'swagger-2',
      title: 'Document API Endpoints',
      description: 'Add Swagger annotations to all endpoints',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 3,
      dependencies: ['swagger-1'],
      tags: ['documentation', 'swagger'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeSwagger'
      }
    },

    // Testing Phase
    {
      id: 'test-1',
      title: 'Write Unit Tests',
      description: 'Create unit tests for services and utilities',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 4,
      dependencies: ['impl-5'],
      tags: ['testing', 'unit-tests'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'test-2',
      title: 'Write API Integration Tests',
      description: 'Test all API endpoints with various scenarios',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 4,
      dependencies: ['impl-5'],
      tags: ['testing', 'integration'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Docker (conditional)
    {
      id: 'docker-1',
      title: 'Create Dockerfile',
      description: 'Build optimized Docker image for ${serviceName}',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 2,
      dependencies: ['impl-5'],
      tags: ['docker', 'containerization'],
      sparcPhase: SPARCPhase.COMPLETION,
      variables: {
        condition: 'includeDocker'
      }
    },
    {
      id: 'docker-2',
      title: 'Create Docker Compose',
      description: 'Setup docker-compose for local development',
      priority: TaskMasterPriority.LOW,
      estimate: 1,
      dependencies: ['docker-1'],
      tags: ['docker', 'development'],
      sparcPhase: SPARCPhase.COMPLETION,
      variables: {
        condition: 'includeDocker'
      }
    },

    // Completion Phase
    {
      id: 'complete-1',
      title: 'API Performance Testing',
      description: 'Load test API endpoints and optimize',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 3,
      dependencies: ['test-2'],
      tags: ['performance', 'testing'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-2',
      title: 'Security Hardening',
      description: 'Implement rate limiting, CORS, and security headers',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['complete-1'],
      tags: ['security', 'hardening'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-3',
      title: 'Create API Documentation',
      description: 'Write comprehensive API documentation',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 3,
      dependencies: ['complete-1'],
      tags: ['documentation'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-4',
      title: 'Setup CI/CD Pipeline',
      description: 'Configure automated testing and deployment',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['complete-2'],
      tags: ['devops', 'ci-cd'],
      sparcPhase: SPARCPhase.COMPLETION
    }
  ],
  createdAt: new Date(),
  updatedAt: new Date()
};