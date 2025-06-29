/// <reference types="jest" />

// Example calculator class to test
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error("Division by zero");
    }
    return a / b;
  }

  async asyncOperation(value: number): Promise<number> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return value * 2;
  }
}

describe("Calculator", () => {
  let calculator: Calculator;

  beforeEach(() => {
    // Setup before each test
    calculator = new Calculator();
  });

  afterEach(() => {
    // Cleanup after each test
    // In a real test, you might clean up resources here
  });

  describe("add", () => {
    it("should add two positive numbers", () => {
      const result = calculator.add(2, 3);
      expect(result).toBe(5);
    });

    it("should handle negative numbers", () => {
      const result = calculator.add(-5, 3);
      expect(result).toBe(-2);
    });

    it("should handle zero", () => {
      const result = calculator.add(0, 0);
      expect(result).toBe(0);
    });
  });

  describe("subtract", () => {
    it("should subtract two numbers", () => {
      const result = calculator.subtract(10, 4);
      expect(result).toBe(6);
    });

    it("should handle negative results", () => {
      const result = calculator.subtract(3, 5);
      expect(result).toBe(-2);
    });
  });

  describe("multiply", () => {
    it("should multiply two numbers", () => {
      const result = calculator.multiply(4, 5);
      expect(result).toBe(20);
    });

    it("should handle multiplication by zero", () => {
      const result = calculator.multiply(10, 0);
      expect(result).toBe(0);
    });
  });

  describe("divide", () => {
    it("should divide two numbers", () => {
      const result = calculator.divide(10, 2);
      expect(result).toBe(5);
    });

    it("should handle decimal results", () => {
      const result = calculator.divide(7, 2);
      expect(result).toBe(3.5);
    });

    it("should throw error when dividing by zero", () => {
      expect(() => calculator.divide(10, 0)).toThrow("Division by zero");
    });
  });

  describe("asyncOperation", () => {
    it("should double the value asynchronously", async () => {
      const result = await calculator.asyncOperation(5);
      expect(result).toBe(10);
    });

    it("should handle zero", async () => {
      const result = await calculator.asyncOperation(0);
      expect(result).toBe(0);
    });
  });

  describe("instance", () => {
    it("should create a calculator instance", () => {
      expect(calculator).toBeDefined();
      expect(calculator).toBeInstanceOf(Calculator);
      expect(typeof calculator.add).toBe("function");
      expect(typeof calculator.subtract).toBe("function");
      expect(typeof calculator.multiply).toBe("function");
      expect(typeof calculator.divide).toBe("function");
    });
  });
});

// Example of using spies and stubs
describe("Calculator with mocks", () => {
  it("should spy on method calls", () => {
    const calculator = new Calculator();
    const addSpy = jest.spyOn(calculator, "add");

    calculator.add(2, 3);
    calculator.add(4, 5);

    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenNthCalledWith(1, 2, 3);
    expect(addSpy).toHaveBeenNthCalledWith(2, 4, 5);
    
    addSpy.mockRestore();
  });

  it("should stub a method", () => {
    const calculator = new Calculator();
    const multiplyStub = jest.spyOn(calculator, "multiply").mockImplementation(() => 100);

    const result = calculator.multiply(2, 3);
    expect(result).toBe(100); // Stubbed value

    multiplyStub.mockRestore();
    const realResult = calculator.multiply(2, 3);
    expect(realResult).toBe(6); // Real value after restore
  });
});
