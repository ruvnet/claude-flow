/**
 * ModeFactory - Creates specific initialization modes
 * Implements the Factory pattern for different initialization strategies
 */

import { IInitMode, InitMode } from '../types/interfaces.js';
import { StandardInit } from '../modes/StandardInit.js';
import { GitHubInit } from '../modes/GitHubInit.js';
import { HiveMindInit } from '../modes/HiveMindInit.js';
import { SparcInit } from '../modes/SparcInit.js';
import { NeuralInit } from '../modes/NeuralInit.js';
import { EnterpriseInit } from '../modes/EnterpriseInit.js';

export class ModeFactory {
  private modes: Map<InitMode, () => IInitMode> = new Map();

  constructor() {
    this.registerModes();
  }

  /**
   * Register all available initialization modes
   */
  private registerModes(): void {
    this.modes.set('standard', () => new StandardInit());
    this.modes.set('github', () => new GitHubInit());
    this.modes.set('hive-mind', () => new HiveMindInit());
    this.modes.set('sparc', () => new SparcInit());
    this.modes.set('neural', () => new NeuralInit());
    this.modes.set('enterprise', () => new EnterpriseInit());
  }

  /**
   * Create a specific initialization mode
   */
  createMode(mode: InitMode): IInitMode {
    const modeFactory = this.modes.get(mode);

    if (!modeFactory) {
      throw new Error(`Unknown initialization mode: ${mode}. Available modes: ${this.getAvailableModes().join(', ')}`);
    }

    return modeFactory();
  }

  /**
   * Get list of available initialization modes
   */
  getAvailableModes(): InitMode[] {
    return Array.from(this.modes.keys());
  }

  /**
   * Get mode descriptions
   */
  getModeDescriptions(): Record<InitMode, string> {
    const descriptions: Partial<Record<InitMode, string>> = {};

    for (const mode of this.getAvailableModes()) {
      try {
        const modeInstance = this.createMode(mode);
        descriptions[mode] = modeInstance.getDescription();
      } catch (error) {
        descriptions[mode] = `Error loading mode: ${error}`;
      }
    }

    return descriptions as Record<InitMode, string>;
  }

  /**
   * Validate if a mode exists and is functional
   */
  validateMode(mode: InitMode): boolean {
    try {
      const modeInstance = this.createMode(mode);
      return modeInstance.validate();
    } catch (error) {
      return false;
    }
  }

  /**
   * Get required components for a specific mode
   */
  getRequiredComponents(mode: InitMode): string[] {
    try {
      const modeInstance = this.createMode(mode);
      return modeInstance.getRequiredComponents();
    } catch (error) {
      return [];
    }
  }

  /**
   * Register a custom initialization mode
   */
  registerCustomMode(mode: InitMode, factory: () => IInitMode): void {
    this.modes.set(mode, factory);
  }

  /**
   * Remove a registered mode
   */
  unregisterMode(mode: InitMode): boolean {
    return this.modes.delete(mode);
  }
}