/// <reference types="jest" />

// Simple utility functions to test
function greet(name: string): string {
  return `Hello, ${name}!`;
}

function sum(numbers: number[]): number {
  return numbers.reduce((acc, num) => acc + num, 0);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe("Simple Test Suite", () => {
  describe("greet function", () => {
    it("should return a greeting message", () => {
      const result = greet("World");
      expect(result).toBe("Hello, World!");
    });

    it("should handle empty string", () => {
      const result = greet("");
      expect(result).toBe("Hello, !");
    });

    it("should handle special characters", () => {
      const result = greet("Claude-Flow 🚀");
      expect(result).toBe("Hello, Claude-Flow 🚀!");
    });
  });

  describe("sum function", () => {
    it("should sum an array of numbers", () => {
      const result = sum([1, 2, 3, 4, 5]);
      expect(result).toBe(15);
    });

    it("should return 0 for empty array", () => {
      const result = sum([]);
      expect(result).toBe(0);
    });

    it("should handle negative numbers", () => {
      const result = sum([-5, 10, -3, 8]);
      expect(result).toBe(10);
    });

    it("should handle decimal numbers", () => {
      const result = sum([1.5, 2.5, 3.0]);
      expect(result).toBe(7.0);
    });
  });

  describe("formatDate function", () => {
    it("should format date correctly", () => {
      const date = new Date(2024, 0, 15); // January 15, 2024
      const result = formatDate(date);
      expect(result).toBe("2024-01-15");
    });

    it("should pad single digit months and days", () => {
      const date = new Date(2024, 2, 5); // March 5, 2024
      const result = formatDate(date);
      expect(result).toBe("2024-03-05");
    });

    it("should handle end of year", () => {
      const date = new Date(2023, 11, 31); // December 31, 2023
      const result = formatDate(date);
      expect(result).toBe("2023-12-31");
    });
  });

  describe("Basic assertions", () => {
    it("should demonstrate various assertions", () => {
      const testValue = "Hello World";
      const testNumber = 42;
      const testArray = [1, 2, 3];
      
      // Check equality
      expect(2 + 2).toBe(4);
      expect("hello".toUpperCase()).toBe("HELLO");
      expect([1, 2, 3].length).toBe(3);
      
      // Check truthy/falsy
      expect(testValue).toBeTruthy();
      expect("").toBeFalsy();
      expect(0).toBeFalsy();
      expect(null).toBeFalsy();
      expect(undefined).toBeFalsy();
      
      // Check type checks
      expect(typeof testNumber).toBe("number");
      expect(typeof testValue).toBe("string");
      expect(Array.isArray(testArray)).toBe(true);
      expect(testArray).toBeInstanceOf(Array);
      
      // Check arrays and objects
      expect(testArray).toContain(2);
      expect(testArray).toHaveLength(3);
      
      // Check numbers
      expect(testNumber).toBeGreaterThan(40);
      expect(testNumber).toBeLessThan(50);
      expect(testNumber).toBeCloseTo(42, 0);
    });
  });
});