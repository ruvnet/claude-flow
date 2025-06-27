/**
 * Compatibility layer for @cliffy/table
 * Maps to cli-table3 for Node.js compatibility
 */

import Table3 from 'cli-table3';

export interface TableOptions {
  border?: boolean;
  maxColWidth?: number;
  minColWidth?: number;
  padding?: number;
  indent?: number;
  align?: 'left' | 'center' | 'right';
  chars?: Record<string, string>;
}

export interface Cell {
  value?: string | number | boolean | null;
  colSpan?: number;
  rowSpan?: number;
  align?: 'left' | 'center' | 'right';
}

type CellValue = string | number | boolean | null | undefined | Cell;
type Row = CellValue[];

export class Table {
  private rows: Row[] = [];
  private headers: Row = [];
  private options: TableOptions;

  constructor(data?: Row[], options?: TableOptions) {
    this.options = options || {};
    if (data) {
      this.rows = data;
    }
  }

  static from(data: Row[], options?: TableOptions): Table {
    return new Table(data, options);
  }

  header(row: Row): this {
    this.headers = row;
    return this;
  }

  body(rows: Row[]): this {
    this.rows = rows;
    return this;
  }

  push(...rows: Row[]): this {
    this.rows.push(...rows);
    return this;
  }

  clone(): Table {
    const table = new Table([], this.options);
    table.headers = [...this.headers];
    table.rows = this.rows.map(row => [...row]);
    return table;
  }

  toString(): string {
    return this.render();
  }

  render(): string {
    const tableOptions: any = {
      style: {
        head: [],
        border: [],
      },
      wordWrap: true,
    };

    // Map cliffy options to cli-table3 options
    if (this.options.border === false) {
      tableOptions.chars = {
        'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
        'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
        'left': '', 'left-mid': '', 'mid': '', 'mid-mid': '',
        'right': '', 'right-mid': '', 'middle': ' ',
      };
    }

    if (this.options.chars) {
      tableOptions.chars = { ...tableOptions.chars, ...this.options.chars };
    }

    const table = new Table3(tableOptions);

    // Add headers if present
    if (this.headers.length > 0) {
      table.push(this.headers.map(h => this.formatCell(h)));
    }

    // Add rows
    for (const row of this.rows) {
      table.push(row.map(cell => this.formatCell(cell)));
    }

    return table.toString();
  }

  private formatCell(cell: CellValue): any {
    if (cell === null || cell === undefined) {
      return '';
    }

    if (typeof cell === 'object' && 'value' in cell) {
      const formatted: any = {
        content: String(cell.value ?? ''),
      };

      if (cell.colSpan) formatted.colSpan = cell.colSpan;
      if (cell.rowSpan) formatted.rowSpan = cell.rowSpan;
      if (cell.align) formatted.hAlign = cell.align;

      return formatted;
    }

    return String(cell);
  }

  // Additional cliffy Table methods for compatibility
  indent(spaces: number): this {
    this.options.indent = spaces;
    return this;
  }

  padding(padding: number): this {
    this.options.padding = padding;
    return this;
  }

  border(enabled: boolean): this {
    this.options.border = enabled;
    return this;
  }

  align(alignment: 'left' | 'center' | 'right'): this {
    this.options.align = alignment;
    return this;
  }

  maxColWidth(width: number): this {
    this.options.maxColWidth = width;
    return this;
  }

  minColWidth(width: number): this {
    this.options.minColWidth = width;
    return this;
  }

  chars(chars: Record<string, string>): this {
    this.options.chars = chars;
    return this;
  }
}

// Export a default table factory function
export function table(rows?: Row[], options?: TableOptions): Table {
  return new Table(rows, options);
}