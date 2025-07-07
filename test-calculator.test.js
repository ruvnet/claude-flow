// Test file for calculator module - Testing parallel operations
const calculator = require('./test-calculator');

describe('Calculator Module', () => {
  describe('add', () => {
    test('adds two positive numbers', () => {
      expect(calculator.add(2, 3)).toBe(5);
    });
    
    test('adds negative numbers', () => {
      expect(calculator.add(-2, -3)).toBe(-5);
    });
  });

  describe('subtract', () => {
    test('subtracts two numbers', () => {
      expect(calculator.subtract(5, 3)).toBe(2);
    });
  });

  describe('multiply', () => {
    test('multiplies two numbers', () => {
      expect(calculator.multiply(4, 5)).toBe(20);
    });
  });

  describe('divide', () => {
    test('divides two numbers', () => {
      expect(calculator.divide(10, 2)).toBe(5);
    });
    
    test('throws error on division by zero', () => {
      expect(() => calculator.divide(5, 0)).toThrow('Division by zero');
    });
  });
});