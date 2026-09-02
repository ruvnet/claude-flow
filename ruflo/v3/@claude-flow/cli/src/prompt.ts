/**
 * V3 CLI Interactive Prompt System
 * Modern interactive prompts for user input
 */

import * as readline from 'readline';
import type {
  SelectPromptOptions,
  SelectOption,
  ConfirmPromptOptions,
  InputPromptOptions,
  MultiSelectPromptOptions
} from './types.js';
import { output, OutputFormatter } from './output.js';

// ============================================
// Core Prompt Infrastructure
// ============================================

class PromptManager {
  private rl: readline.Interface | null = null;
  private formatter: OutputFormatter;

  constructor(formatter: OutputFormatter = output) {
    this.formatter = formatter;
  }

  private createInterface(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
      });

      // Handle cleanup on exit
      this.rl.on('close', () => {
        this.rl = null;
      });
    }
    return this.rl;
  }

  private close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  private async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = this.createInterface();
      rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  // ============================================
  // Select Prompt
  // ============================================

  async select<T = string>(options: SelectPromptOptions<T>): Promise<T> {
    const { message, options: choices, default: defaultValue, pageSize = 10 } = options;

    this.formatter.writeln();
    this.formatter.writeln(this.formatter.bold(`? ${message}`));
    this.formatter.writeln(this.formatter.dim('  (Use arrow keys to navigate, enter to select)'));
    this.formatter.writeln();

    // Find default index
    let selectedIndex = 0;
    if (defaultValue !== undefined) {
      const idx = choices.findIndex(c => c.value === defaultValue);
      if (idx !== -1) selectedIndex = idx;
    }

    // Display options
    const displayChoices = (currentIndex: number, startIndex: number = 0) => {
      // Move cursor up to overwrite
      if (startIndex > 0 || currentIndex > 0) {
        process.stdout.write(`\x1b[${Math.min(choices.length, pageSize)}A`);
      }

      const endIndex = Math.min(startIndex + pageSize, choices.length);
      for (let i = startIndex; i < endIndex; i++) {
        const choice = choices[i];
        const isSelected = i === currentIndex;
        const prefix = isSelected ? this.formatter.info('>') : ' ';
        const label = isSelected
          ? this.formatter.highlight(choice.label)
          : choice.label;
        const hint = choice.hint ? this.formatter.dim(` - ${choice.hint}`) : '';
        const disabled = choice.disabled ? this.formatter.dim(' (disabled)') : '';

        this.formatter.writeln(`  ${prefix} ${label}${hint}${disabled}`);
      }
    };

    // Initial display
    displayChoices(selectedIndex);

    return new Promise<T>((resolve, reject) => {
      const rl = this.createInterface();

      // Enable raw mode for arrow key detection
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const handleKeypress = (key: Buffer) => {
        const keyStr = key.toString();

        // Arrow keys
        if (keyStr === '\x1b[A') { // Up
          do {
            selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
          } while (choices[selectedIndex].disabled && selectedIndex !== 0);
          displayChoices(selectedIndex);
        } else if (keyStr === '\x1b[B') { // Down
          do {
            selectedIndex = (selectedIndex + 1) % choices.length;
          } while (choices[selectedIndex].disabled && selectedIndex !== choices.length - 1);
          displayChoices(selectedIndex);
        } else if (keyStr === '\r' || keyStr === '\n') { // Enter
          cleanup();
          const selected = choices[selectedIndex];
          if (!selected.disabled) {
            this.formatter.writeln();
            this.formatter.writeln(this.formatter.success(`Selected: ${selected.label}`));
            resolve(selected.value);
          }
        } else if (keyStr === '\x03') { // Ctrl+C
          cleanup();
          reject(new Error('User cancelled'));
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('data', handleKeypress);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        this.close();
      };

      process.stdin.on('data', handleKeypress);
    });
  }

  // ============================================
  // Confirm Prompt
  // ============================================

  async confirm(options: ConfirmPromptOptions): Promise<boolean> {
    const {
      message,
      default: defaultValue = false,
      active = 'Yes',
      inactive = 'No'
    } = options;

    const defaultText = defaultValue ? `${active}/${inactive}` : `${active}/${inactive}`;
    const hint = defaultValue ? `[${active}]` : `[${inactive}]`;

    const prompt = `${this.formatter.bold('?')} ${message} ${this.formatter.dim(hint)} `;

    const answer = await this.question(prompt);
    this.close();

    if (answer === '') {
      return defaultValue;
    }

    const normalized = answer.toLowerCase().trim();

    if (['y', 'yes', 'true', '1'].includes(normalized)) {
      return true;
    }

    if (['n', 'no', 'false', '0'].includes(normalized)) {
      return false;
    }

    return defaultValue;
  }

  // ============================================
  // Input Prompt
  // ============================================

  async input(options: InputPromptOptions): Promise<string> {
    const {
      message,
      default: defaultValue,
      placeholder,
      validate,
      mask
    } = options;

    let prompt = `${this.formatter.bold('?')} ${message}`;

    if (defaultValue) {
      prompt += ` ${this.formatter.dim(`(${defaultValue})`)}`;
    } else if (placeholder) {
      prompt += ` ${this.formatter.dim(placeholder)}`;
    }

    prompt += ': ';

    while (true) {
      let answer: string;

      if (mask) {
        answer = await this.inputMasked(prompt);
      } else {
        answer = await this.question(prompt);
      }

      // Use default if empty
      if (answer === '' && defaultValue !== undefined) {
        answer = defaultValue;
      }

      // Validate
      if (validate) {
        const result = validate(answer);
        if (result !== true) {
          const errorMsg = typeof result === 'string' ? result : 'Invalid input';
          this.formatter.writeln(this.formatter.error(`  ${errorMsg}`));
          continue;
        }
      }

      this.close();
      return answer;
    }
  }

  private async inputMasked(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = this.createInterface();
      let password = '';

      // Don't echo characters
      process.stdout.write(prompt);

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const handleData = (chunk: Buffer) => {
        const char = chunk.toString();

        if (char === '\n' || char === '\r') {
          // Enter pressed
          process.stdin.removeListener('data', handleData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdout.write('\n');
          resolve(password);
        } else if (char === '\x7f' || char === '\x08') {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char === '\x03') {
          // Ctrl+C
          process.stdin.removeListener('data', handleData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          resolve('');
        } else if (char.charCodeAt(0) >= 32) {
          // Printable character
          password += char;
          process.stdout.write('*');
        }
      };

      process.stdin.on('data', handleData);
    });
  }

  // ============================================
  // Multi-Select Prompt
  // ============================================

  async multiSelect<T = string>(options: MultiSelectPromptOptions<T>): Promise<T[]> {
    const {
      message,
      options: choices,
      default: defaultValues = [],
      required = false,
      min,
      max
    } = options;

    this.formatter.writeln();
    this.formatter.writeln(this.formatter.bold(`? ${message}`));
    this.formatter.writeln(this.formatter.dim('  (Use arrow keys to navigate, space to select, enter to confirm)'));
    this.formatter.writeln();

    // Initialize selection state
    const selected = new Set<number>();
    for (let i = 0; i < choices.length; i++) {
      // Check both default array and individual selected property
      if (defaultValues.includes(choices[i].value) || choices[i].selected) {
        selected.add(i);
      }
    }

    let currentIndex = 0;

    // Display options
    const displayChoices = () => {
      // Move cursor up to overwrite
      process.stdout.write(`\x1b[${choices.length}A`);

      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        const isCurrentRow = i === currentIndex;
        const isSelected = selected.has(i);

        const cursor = isCurrentRow ? this.formatter.info('>') : ' ';
        const checkbox = isSelected
          ? this.formatter.success('[x]')
          : this.formatter.dim('[ ]');
        const label = isCurrentRow
          ? this.formatter.highlight(choice.label)
          : choice.label;
        const hint = choice.hint ? this.formatter.dim(` - ${choice.hint}`) : '';
        const disabled = choice.disabled ? this.formatter.dim(' (disabled)') : '';

        this.formatter.writeln(`  ${cursor} ${checkbox} ${label}${hint}${disabled}`);
      }
    };

    // Initial display
    for (let i = 0; i < choices.length; i++) {
      this.formatter.writeln('');
    }
    displayChoices();

    return new Promise<T[]>((resolve, reject) => {
      const rl = this.createInterface();

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const handleKeypress = (key: Buffer) => {
        const keyStr = key.toString();

        if (keyStr === '\x1b[A') { // Up
          currentIndex = (currentIndex - 1 + choices.length) % choices.length;
          displayChoices();
        } else if (keyStr === '\x1b[B') { // Down
          currentIndex = (currentIndex + 1) % choices.length;
          displayChoices();
        } else if (keyStr === ' ') { // Space
          if (!choices[currentIndex].disabled) {
            if (selected.has(currentIndex)) {
              selected.delete(currentIndex);
            } else {
              // Check max limit
              if (!max || selected.size < max) {
                selected.add(currentIndex);
              }
            }
            displayChoices();
          }
        } else if (keyStr === '\r' || keyStr === '\n') { // Enter
          // Validate selection
          if (required && selected.size === 0) {
            this.formatter.writeln(this.formatter.error('  At least one option must be selected'));
            return;
          }
          if (min && selected.size < min) {
            this.formatter.writeln(this.formatter.error(`  At least ${min} options must be selected`));
            return;
          }

          cleanup();
          const selectedValues = Array.from(selected).map(i => choices[i].value);
          const selectedLabels = Array.from(selected).map(i => choices[i].label);
          this.formatter.writeln();
          this.formatter.writeln(this.formatter.success(`Selected: ${selectedLabels.join(', ')}`));
          resolve(selectedValues);
        } else if (keyStr === '\x03') { // Ctrl+C
          cleanup();
          reject(new Error('User cancelled'));
        } else if (keyStr === 'a') { // Select all
          if (!max || choices.length <= max) {
            for (let i = 0; i < choices.length; i++) {
              if (!choices[i].disabled) {
                selected.add(i);
              }
            }
            displayChoices();
          }
        } else if (keyStr === 'n') { // Select none
          selected.clear();
          displayChoices();
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('data', handleKeypress);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        this.close();
      };

      process.stdin.on('data', handleKeypress);
    });
  }

  // ============================================
  // Text Prompt (Multi-line)
  // ============================================

  async text(message: string, placeholder?: string): Promise<string> {
    this.formatter.writeln();
    this.formatter.writeln(this.formatter.bold(`? ${message}`));
    if (placeholder) {
      this.formatter.writeln(this.formatter.dim(`  ${placeholder}`));
    }
    this.formatter.writeln(this.formatter.dim('  (Enter an empty line to finish)'));
    this.formatter.writeln();

    const lines: string[] = [];

    while (true) {
      const line = await this.question('  > ');
      if (line === '') {
        break;
      }
      lines.push(line);
    }

    this.close();
    return lines.join('\n');
  }

  // ============================================
  // Number Prompt
  // ============================================

  async number(
    message: string,
    options: { default?: number; min?: number; max?: number; } = {}
  ): Promise<number> {
    const { default: defaultValue, min, max } = options;

    const validate = (value: string): boolean | string => {
      const num = Number(value);
      if (isNaN(num)) {
        return 'Please enter a valid number';
      }
      if (min !== undefined && num < min) {
        return `Value must be at least ${min}`;
      }
      if (max !== undefined && num > max) {
        return `Value must be at most ${max}`;
      }
      return true;
    };

    const result = await this.input({
      message,
      default: defaultValue?.toString(),
      validate
    });

    return Number(result);
  }

  // ============================================
  // Autocomplete Prompt
  // ============================================

  async autocomplete<T = string>(
    message: string,
    choices: SelectOption<T>[],
    options: { limit?: number } = {}
  ): Promise<T> {
    const { limit = 10 } = options;

    this.formatter.writeln();
    this.formatter.writeln(this.formatter.bold(`? ${message}`));
    this.formatter.writeln(this.formatter.dim('  (Type to filter, arrow keys to navigate)'));

    let query = '';
    let selectedIndex = 0;
    let filteredChoices = choices.slice(0, limit);

    const filterChoices = (q: string): SelectOption<T>[] => {
      if (q === '') return choices.slice(0, limit);

      const normalized = q.toLowerCase();
      return choices
        .filter(c => c.label.toLowerCase().includes(normalized))
        .slice(0, limit);
    };

    const displayChoices = () => {
      // Clear previous output
      process.stdout.write(`\x1b[${filteredChoices.length + 1}A`);
      process.stdout.write('\x1b[J');

      // Show input
      this.formatter.writeln(`  ${this.formatter.dim('>')} ${query}`);

      // Show filtered options
      for (let i = 0; i < filteredChoices.length; i++) {
        const choice = filteredChoices[i];
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? this.formatter.info('>') : ' ';
        const label = isSelected ? this.formatter.highlight(choice.label) : choice.label;
        this.formatter.writeln(`  ${prefix} ${label}`);
      }
    };

    // Initial display
    this.formatter.writeln('');
    for (let i = 0; i < limit; i++) {
      this.formatter.writeln('');
    }
    displayChoices();

    return new Promise<T>((resolve, reject) => {
      const rl = this.createInterface();

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const handleKeypress = (key: Buffer) => {
        const keyStr = key.toString();

        if (keyStr === '\x1b[A') { // Up
          selectedIndex = Math.max(0, selectedIndex - 1);
          displayChoices();
        } else if (keyStr === '\x1b[B') { // Down
          selectedIndex = Math.min(filteredChoices.length - 1, selectedIndex + 1);
          displayChoices();
        } else if (keyStr === '\r' || keyStr === '\n') { // Enter
          if (filteredChoices.length > 0) {
            cleanup();
            const selected = filteredChoices[selectedIndex];
            this.formatter.writeln();
            this.formatter.writeln(this.formatter.success(`Selected: ${selected.label}`));
            resolve(selected.value);
          }
        } else if (keyStr === '\x7f' || keyStr === '\x08') { // Backspace
          query = query.slice(0, -1);
          filteredChoices = filterChoices(query);
          selectedIndex = 0;
          displayChoices();
        } else if (keyStr === '\x03') { // Ctrl+C
          cleanup();
          reject(new Error('User cancelled'));
        } else if (keyStr.charCodeAt(0) >= 32 && keyStr.charCodeAt(0) < 127) {
          // Printable character
          query += keyStr;
          filteredChoices = filterChoices(query);
          selectedIndex = 0;
          displayChoices();
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('data', handleKeypress);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        this.close();
      };

      process.stdin.on('data', handleKeypress);
    });
  }
}

// Export singleton and convenience functions
export const promptManager = new PromptManager();

export const select = <T = string>(options: SelectPromptOptions<T>) =>
  promptManager.select(options);

export const confirm = (options: ConfirmPromptOptions) =>
  promptManager.confirm(options);

export const input = (options: InputPromptOptions) =>
  promptManager.input(options);

export const multiSelect = <T = string>(options: MultiSelectPromptOptions<T>) =>
  promptManager.multiSelect(options);

export const text = (message: string, placeholder?: string) =>
  promptManager.text(message, placeholder);

export const number = (message: string, options?: { default?: number; min?: number; max?: number }) =>
  promptManager.number(message, options);

export const autocomplete = <T = string>(
  message: string,
  choices: SelectOption<T>[],
  options?: { limit?: number }
) => promptManager.autocomplete(message, choices, options);
