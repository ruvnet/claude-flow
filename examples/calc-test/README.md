# Simple Calculator

A basic calculator implementation with add and subtract functions.

## Features

- Basic arithmetic operations: addition and subtraction
- Support for both standalone operations and chained operations
- Internal result storage for sequential calculations
- Handles integers, decimals, and negative numbers

## Usage

```javascript
const Calculator = require('./calculator');

const calc = new Calculator();

// Basic operations
calc.add(5, 3);        // Returns 8
calc.subtract(10, 3);  // Returns 7

// Chained operations
calc.clear();          // Reset to 0
calc.add(10);          // Adds to internal result: 10
calc.add(5);           // Adds to internal result: 15
calc.subtract(3);      // Subtracts from internal result: 12
calc.getResult();      // Returns current result: 12
```

## API

- `add(a, b)` - Adds two numbers
- `add(a)` - Adds to internal result
- `subtract(a, b)` - Subtracts b from a
- `subtract(a)` - Subtracts from internal result
- `clear()` - Resets internal result to 0
- `getResult()` - Returns current internal result

## Running the Demo

```bash
node test.js
```