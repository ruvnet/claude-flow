// Greeter module for Hello World application

/**
 * Generate a greeting message
 * @param {string} name - The name to greet
 * @returns {string} The greeting message
 */
function greet(name) {
  return `Hello, ${name}!`;
}

/**
 * Generate a formal greeting
 * @param {string} title - The title (Mr., Ms., Dr., etc.)
 * @param {string} lastName - The last name
 * @returns {string} The formal greeting
 */
function greetFormal(title, lastName) {
  return `Good day, ${title} ${lastName}.`;
}

module.exports = {
  greet,
  greetFormal
};