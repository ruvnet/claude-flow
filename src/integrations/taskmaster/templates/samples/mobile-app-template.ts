/**
 * Mobile Application Template
 * Template for building cross-platform mobile applications
 */

import { TaskTemplate, TemplateCategory, VariableType } from '../types/template-types.ts';
import { TaskMasterStatus, TaskMasterPriority, SPARCPhase } from '../../types/task-types.ts';

export const mobileAppTemplate: TaskTemplate = {
  id: 'mobile-app-template',
  name: 'Cross-Platform Mobile App',
  description: 'Template for building mobile applications with modern frameworks',
  category: TemplateCategory.MOBILE_DEVELOPMENT,
  version: '1.0.0',
  author: 'TaskMaster Team',
  tags: ['mobile', 'ios', 'android', 'cross-platform'],
  metadata: {
    icon: '📱',
    color: '#9b59b6',
    estimatedHours: 60,
    complexity: 'high'
  },
  variables: [
    {
      name: 'appName',
      type: VariableType.STRING,
      description: 'Name of the mobile application',
      required: true,
      validation: {
        pattern: '^[a-zA-Z0-9 ]+$'
      }
    },
    {
      name: 'framework',
      type: VariableType.ENUM,
      description: 'Mobile framework to use',
      required: true,
      options: ['React Native', 'Flutter', 'Ionic', 'NativeScript'],
      default: 'React Native'
    },
    {
      name: 'platforms',
      type: VariableType.ARRAY,
      description: 'Target platforms',
      required: true,
      default: ['iOS', 'Android']
    },
    {
      name: 'includeBackend',
      type: VariableType.BOOLEAN,
      description: 'Include backend API development',
      required: false,
      default: true
    },
    {
      name: 'includePushNotifications',
      type: VariableType.BOOLEAN,
      description: 'Include push notification support',
      required: false,
      default: true
    }
  ],
  tasks: [
    // Specification Phase
    {
      id: 'spec-1',
      title: 'Define ${appName} Mobile Requirements',
      description: 'Document app features and user requirements',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      tags: ['specification', 'requirements'],
      sparcPhase: SPARCPhase.SPECIFICATION
    },
    {
      id: 'spec-2',
      title: 'Create UI/UX Mockups',
      description: 'Design app screens and user flows',
      priority: TaskMasterPriority.HIGH,
      estimate: 6,
      dependencies: ['spec-1'],
      tags: ['design', 'ui-ux'],
      sparcPhase: SPARCPhase.SPECIFICATION
    },

    // Architecture Phase
    {
      id: 'arch-1',
      title: 'Design App Architecture',
      description: 'Plan ${framework} architecture and state management',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['spec-2'],
      tags: ['architecture', 'mobile'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },
    {
      id: 'arch-2',
      title: 'Plan Navigation Structure',
      description: 'Design app navigation and screen hierarchy',
      priority: TaskMasterPriority.HIGH,
      estimate: 2,
      dependencies: ['arch-1'],
      tags: ['architecture', 'navigation'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },
    {
      id: 'arch-3',
      title: 'Design Data Layer',
      description: 'Plan local storage and API integration',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['arch-1'],
      tags: ['architecture', 'data'],
      sparcPhase: SPARCPhase.ARCHITECTURE
    },

    // Implementation Phase - Setup
    {
      id: 'impl-setup-1',
      title: 'Initialize ${framework} Project',
      description: 'Setup development environment and project structure',
      priority: TaskMasterPriority.HIGH,
      estimate: 2,
      dependencies: ['arch-3'],
      tags: ['setup', 'mobile'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-setup-2',
      title: 'Configure Platform-Specific Settings',
      description: 'Setup iOS and Android configurations',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['impl-setup-1'],
      tags: ['setup', 'platform'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Implementation Phase - Core Features
    {
      id: 'impl-core-1',
      title: 'Implement Navigation System',
      description: 'Build app navigation with ${framework}',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['impl-setup-2'],
      tags: ['implementation', 'navigation'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-core-2',
      title: 'Create UI Components',
      description: 'Build reusable UI components library',
      priority: TaskMasterPriority.HIGH,
      estimate: 6,
      dependencies: ['impl-setup-2'],
      tags: ['implementation', 'ui'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-core-3',
      title: 'Implement State Management',
      description: 'Setup state management solution',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['impl-core-1'],
      tags: ['implementation', 'state'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'impl-core-4',
      title: 'Build App Screens',
      description: 'Implement all application screens',
      priority: TaskMasterPriority.HIGH,
      estimate: 10,
      dependencies: ['impl-core-2', 'impl-core-3'],
      tags: ['implementation', 'screens'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Backend Integration (conditional)
    {
      id: 'backend-1',
      title: 'Setup Backend API',
      description: 'Create backend services for ${appName}',
      priority: TaskMasterPriority.HIGH,
      estimate: 8,
      dependencies: ['arch-3'],
      tags: ['backend', 'api'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeBackend'
      }
    },
    {
      id: 'backend-2',
      title: 'Integrate API in Mobile App',
      description: 'Connect mobile app with backend services',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['impl-core-4', 'backend-1'],
      tags: ['integration', 'api'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includeBackend'
      }
    },

    // Push Notifications (conditional)
    {
      id: 'push-1',
      title: 'Setup Push Notification Service',
      description: 'Configure Firebase/APNS for push notifications',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 3,
      dependencies: ['impl-core-4'],
      tags: ['notifications', 'service'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includePushNotifications'
      }
    },
    {
      id: 'push-2',
      title: 'Implement Push Notifications',
      description: 'Add push notification handling in app',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 4,
      dependencies: ['push-1'],
      tags: ['notifications', 'implementation'],
      sparcPhase: SPARCPhase.REFINEMENT,
      variables: {
        condition: 'includePushNotifications'
      }
    },

    // Platform-Specific Features
    {
      id: 'platform-1',
      title: 'Implement Platform-Specific Features',
      description: 'Add iOS and Android specific functionality',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 4,
      dependencies: ['impl-core-4'],
      tags: ['platform', 'native'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'platform-2',
      title: 'Handle Device Permissions',
      description: 'Implement camera, location, and other permissions',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['platform-1'],
      tags: ['permissions', 'platform'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Testing Phase
    {
      id: 'test-1',
      title: 'Write Unit Tests',
      description: 'Create unit tests for components and logic',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 5,
      dependencies: ['impl-core-4'],
      tags: ['testing', 'unit'],
      sparcPhase: SPARCPhase.REFINEMENT
    },
    {
      id: 'test-2',
      title: 'Platform Testing',
      description: 'Test on iOS and Android devices/simulators',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['platform-2'],
      tags: ['testing', 'platform'],
      sparcPhase: SPARCPhase.REFINEMENT
    },

    // Completion Phase
    {
      id: 'complete-1',
      title: 'Performance Optimization',
      description: 'Optimize app performance and bundle size',
      priority: TaskMasterPriority.MEDIUM,
      estimate: 4,
      dependencies: ['test-2'],
      tags: ['optimization', 'performance'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-2',
      title: 'App Store Assets',
      description: 'Create screenshots, icons, and store descriptions',
      priority: TaskMasterPriority.HIGH,
      estimate: 3,
      dependencies: ['complete-1'],
      tags: ['assets', 'store'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-3',
      title: 'Prepare for Submission',
      description: 'Configure app for iOS App Store and Google Play',
      priority: TaskMasterPriority.HIGH,
      estimate: 4,
      dependencies: ['complete-2'],
      tags: ['submission', 'store'],
      sparcPhase: SPARCPhase.COMPLETION
    },
    {
      id: 'complete-4',
      title: 'Submit to App Stores',
      description: 'Submit ${appName} to app stores',
      priority: TaskMasterPriority.HIGH,
      estimate: 2,
      dependencies: ['complete-3'],
      tags: ['submission', 'release'],
      sparcPhase: SPARCPhase.COMPLETION
    }
  ],
  createdAt: new Date(),
  updatedAt: new Date()
};