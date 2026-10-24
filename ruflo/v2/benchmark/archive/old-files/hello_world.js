/**
 * Simple Hello World function in JavaScript
 * @param {string} name - Optional name parameter
 * @returns {string} Greeting message
 */
export function helloWorld(name = 'World') {
  return `Hello, ${name}!`;
}

// Example usage
console.log(helloWorld());        // Output: Hello, World!
console.log(helloWorld('Claude')); // Output: Hello, Claude!