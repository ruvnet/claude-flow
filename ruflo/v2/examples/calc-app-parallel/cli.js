#!/usr/bin/env node
const Calculator = require('./calculator');
const readline = require('readline');

const calc = new Calculator();
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Simple Calculator');
console.log('Available operations: add, subtract, multiply, divide, power, sqrt');
console.log('Type "exit" to quit\n');

function prompt() {
  rl.question('Enter operation: ', (operation) => {
    if (operation === 'exit') {
      rl.close();
      return;
    }

    if (operation === 'sqrt') {
      rl.question('Enter number: ', (num) => {
        try {
          const result = calc.sqrt(parseFloat(num));
          console.log(`Result: ${result}\n`);
        } catch (error) {
          console.log(`Error: ${error.message}\n`);
        }
        prompt();
      });
    } else {
      rl.question('Enter first number: ', (num1) => {
        rl.question('Enter second number: ', (num2) => {
          try {
            const a = parseFloat(num1);
            const b = parseFloat(num2);
            let result;

            switch (operation) {
              case 'add':
                result = calc.add(a, b);
                break;
              case 'subtract':
                result = calc.subtract(a, b);
                break;
              case 'multiply':
                result = calc.multiply(a, b);
                break;
              case 'divide':
                result = calc.divide(a, b);
                break;
              case 'power':
                result = calc.power(a, b);
                break;
              default:
                console.log('Invalid operation\n');
                prompt();
                return;
            }

            console.log(`Result: ${result}\n`);
          } catch (error) {
            console.log(`Error: ${error.message}\n`);
          }
          prompt();
        });
      });
    }
  });
}

prompt();
