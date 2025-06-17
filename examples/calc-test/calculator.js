class Calculator {
  constructor() {
    this.result = 0;
  }

  add(a, b) {
    if (arguments.length === 1) {
      this.result += a;
      return this.result;
    }
    return a + b;
  }

  subtract(a, b) {
    if (arguments.length === 1) {
      this.result -= a;
      return this.result;
    }
    return a - b;
  }

  clear() {
    this.result = 0;
    return this.result;
  }

  getResult() {
    return this.result;
  }
}

module.exports = Calculator;