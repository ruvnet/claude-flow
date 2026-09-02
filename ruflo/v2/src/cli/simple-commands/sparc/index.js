// SPARC Methodology Implementation
// Specification, Pseudocode, Architecture, Refinement, Completion

import { SparcSpecification } from './specification.js';
import { SparcPseudocode } from './pseudocode.js';
import { SparcArchitecture } from './architecture.js';
import { SparcRefinement } from './refinement.js';
import { SparcCompletion } from './completion.js';
import { SparcCoordinator } from './coordinator.js';

export class SparcMethodology {
  constructor(taskDescription, options = {}) {
    this.taskDescription = taskDescription;
    this.options = {
      namespace: options.namespace || 'sparc',
      swarmEnabled: options.swarmEnabled || false,
      neuralLearning: options.neuralLearning || false,
      verbose: options.verbose || false,
      ...options,
    };

    this.phases = {
      specification: new SparcSpecification(this.taskDescription, this.options),
      pseudocode: new SparcPseudocode(this.taskDescription, this.options),
      architecture: new SparcArchitecture(this.taskDescription, this.options),
      refinement: new SparcRefinement(this.taskDescription, this.options),
      completion: new SparcCompletion(this.taskDescription, this.options),
    };

    this.coordinator = new SparcCoordinator(this.phases, this.options);
    this.currentPhase = 'specification';
    this.phaseOrder = ['specification', 'pseudocode', 'architecture', 'refinement', 'completion'];
    this.artifacts = {};
    this.qualityGates = {};
  }

  /**
   * Execute the complete SPARC methodology
   */
  async execute() {
    console.log('🚀 Starting SPARC Methodology Execution');
    console.log(`📋 Task: ${this.taskDescription}`);
    console.log(`🔧 Namespace: ${this.options.namespace}`);
    console.log(`🐝 Swarm: ${this.options.swarmEnabled ? 'Enabled' : 'Disabled'}`);
    console.log();

    // Initialize swarm if enabled
    if (this.options.swarmEnabled) {
      await this.coordinator.initializeSwarm();
    }

    // Execute each phase in order
    for (const phaseName of this.phaseOrder) {
      console.log(`\n📍 Phase: ${phaseName.toUpperCase()}`);

      try {
        // Pre-phase coordination
        await this.coordinator.prePhase(phaseName);

        // Execute phase
        const phase = this.phases[phaseName];
        const result = await phase.execute();

        // Store artifacts
        this.artifacts[phaseName] = result;

        // Quality gate validation
        const qualityGate = await this.validateQualityGate(phaseName, result);
        this.qualityGates[phaseName] = qualityGate;

        if (!qualityGate.passed) {
          console.log(`❌ Quality Gate Failed for ${phaseName}`);
          console.log(`Reasons: ${qualityGate.reasons.join(', ')}`);

          // Attempt auto-remediation
          if (this.options.autoRemediation) {
            await this.autoRemediate(phaseName, qualityGate);
          } else {
            throw new Error(`Quality gate failed for phase: ${phaseName}`);
          }
        }

        // Post-phase coordination
        await this.coordinator.postPhase(phaseName, result);

        console.log(`✅ ${phaseName} completed successfully`);
      } catch (error) {
        console.error(`❌ Error in ${phaseName}: ${error.message}`);

        // Neural learning from failures
        if (this.options.neuralLearning) {
          await this.learnFromFailure(phaseName, error);
        }

        throw error;
      }
    }

    // Final coordination and cleanup
    await this.coordinator.finalize();

    console.log('\n🎉 SPARC Methodology Execution Complete');
    return this.generateSummary();
  }

  /**
   * Execute a specific phase
   */
  async executePhase(phaseName) {
    if (!this.phases[phaseName]) {
      throw new Error(`Unknown phase: ${phaseName}`);
    }

    console.log(`📍 Executing Phase: ${phaseName.toUpperCase()}`);

    const phase = this.phases[phaseName];
    const result = await phase.execute();

    this.artifacts[phaseName] = result;
    return result;
  }

  /**
   * Validate quality gate for a phase
   */
  async validateQualityGate(phaseName, result) {
    const qualityGate = {
      passed: true,
      reasons: [],
    };

    switch (phaseName) {
      case 'specification':
        if (!result.requirements || result.requirements.length === 0) {
          qualityGate.passed = false;
          qualityGate.reasons.push('No requirements defined');
        }
        if (!result.acceptanceCriteria || result.acceptanceCriteria.length === 0) {
          qualityGate.passed = false;
          qualityGate.reasons.push('No acceptance criteria defined');
        }
        break;

      case 'pseudocode':
        if (!result.flowDiagram) {
          qualityGate.passed = false;
          qualityGate.reasons.push('No flow diagram created');
        }
        if (!result.pseudocode || result.pseudocode.length < 10) {
          qualityGate.passed = false;
          qualityGate.reasons.push('Insufficient pseudocode detail');
        }
        break;

      case 'architecture':
        if (!result.components || result.components.length === 0) {
          qualityGate.passed = false;
          qualityGate.reasons.push('No components defined');
        }
        if (!result.designPatterns || result.designPatterns.length === 0) {
          qualityGate.passed = false;
          qualityGate.reasons.push('No design patterns specified');
        }
        break;

      case 'refinement':
        if (!result.testResults || result.testResults.passed === 0) {
          qualityGate.passed = false;
          qualityGate.reasons.push('No passing tests');
        }
        if (result.codeQuality && result.codeQuality.score < 0.8) {
          qualityGate.passed = false;
          qualityGate.reasons.push('Code quality below threshold');
        }
        break;

      case 'completion':
        if (!result.validated) {
          qualityGate.passed = false;
          qualityGate.reasons.push('Final validation failed');
        }
        if (!result.documented) {
          qualityGate.passed = false;
          qualityGate.reasons.push('Documentation incomplete');
        }
        break;
    }

    return qualityGate;
  }

  /**
   * Auto-remediate quality gate failures
   */
  async autoRemediate(phaseName, qualityGate) {
    console.log(`🔄 Attempting auto-remediation for ${phaseName}`);

    // Neural learning can inform remediation strategies
    if (this.options.neuralLearning) {
      await this.learnFromFailure(
        phaseName,
        new Error(`Quality gate failed: ${qualityGate.reasons.join(', ')}`),
      );
    }

    // Re-execute the phase with enhanced context
    const phase = this.phases[phaseName];
    phase.setRemediationContext(qualityGate);

    const result = await phase.execute();
    this.artifacts[phaseName] = result;

    // Re-validate
    const newQualityGate = await this.validateQualityGate(phaseName, result);
    this.qualityGates[phaseName] = newQualityGate;

    if (!newQualityGate.passed) {
      throw new Error(
        `Auto-remediation failed for ${phaseName}: ${newQualityGate.reasons.join(', ')}`,
      );
    }

    console.log(`✅ Auto-remediation successful for ${phaseName}`);
  }

  /**
   * Neural learning from failures
   */
  async learnFromFailure(phaseName, error) {
    const learningData = {
      phase: phaseName,
      task: this.taskDescription,
      error: error.message,
      timestamp: new Date().toISOString(),
      context: this.artifacts,
    };

    // Store learning data for neural network training
    if (this.options.neuralLearning) {
      await this.coordinator.recordLearning(learningData);
    }
  }

  /**
   * Generate execution summary
   */
  generateSummary() {
    const summary = {
      taskDescription: this.taskDescription,
      executionTime: Date.now() - this.startTime,
      phases: this.phaseOrder.map((phase) => ({
        name: phase,
        status: this.qualityGates[phase]?.passed ? 'passed' : 'failed',
        artifacts: this.artifacts[phase],
      })),
      qualityGates: this.qualityGates,
      artifacts: this.artifacts,
      recommendations: this.generateRecommendations(),
    };

    return summary;
  }

  /**
   * Generate recommendations based on execution
   */
  generateRecommendations() {
    const recommendations = [];

    // Analyze quality gate failures
    for (const [phase, gate] of Object.entries(this.qualityGates)) {
      if (!gate.passed) {
        recommendations.push({
          type: 'quality_improvement',
          phase: phase,
          message: `Improve ${phase} quality: ${gate.reasons.join(', ')}`,
        });
      }
    }

    // Analyze artifacts for optimization opportunities
    if (this.artifacts.architecture && this.artifacts.architecture.components.length > 10) {
      recommendations.push({
        type: 'architecture_optimization',
        message: 'Consider breaking down architecture into smaller, more manageable components',
      });
    }

    return recommendations;
  }

  /**
   * Get current phase status
   */
  getPhaseStatus(phaseName) {
    return {
      name: phaseName,
      completed: !!this.artifacts[phaseName],
      qualityGate: this.qualityGates[phaseName],
      artifacts: this.artifacts[phaseName],
    };
  }

  /**
   * Get overall progress
   */
  getProgress() {
    const completedPhases = Object.keys(this.artifacts).length;
    const totalPhases = this.phaseOrder.length;

    return {
      completed: completedPhases,
      total: totalPhases,
      percentage: (completedPhases / totalPhases) * 100,
      currentPhase: this.currentPhase,
      phases: this.phaseOrder.map((phase) => this.getPhaseStatus(phase)),
    };
  }
}

export default SparcMethodology;
