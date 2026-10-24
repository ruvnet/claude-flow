// Temporary workaround for TypeScript compiler bug with Commander overloads
import { Command as CommandConstructor } from 'commander';

// Export the Command class directly to avoid overload issues
export const Command = CommandConstructor;
export default Command;