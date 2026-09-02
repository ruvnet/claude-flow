/**
 * V3 MCP Types and Interfaces
 *
 * Optimized type definitions for the V3 MCP server with:
 * - Strict typing for performance
 * - Connection pooling types
 * - Transport layer abstractions
 * - Tool registry interfaces
 *
 * Performance Targets:
 * - Server startup: <400ms
 * - Tool registration: <10ms
 * - Tool execution: <50ms overhead
 */
// ============================================================================
// Error Codes
// ============================================================================
/**
 * Standard JSON-RPC error codes
 */
export const ErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    SERVER_NOT_INITIALIZED: -32002,
    UNKNOWN_ERROR: -32001,
    REQUEST_CANCELLED: -32800,
    RATE_LIMITED: -32000,
    AUTHENTICATION_REQUIRED: -32001,
    AUTHORIZATION_FAILED: -32002,
};
/**
 * MCP Error class
 */
export class MCPServerError extends Error {
    code;
    data;
    constructor(message, code = ErrorCodes.INTERNAL_ERROR, data) {
        super(message);
        this.code = code;
        this.data = data;
        this.name = 'MCPServerError';
    }
    toMCPError() {
        return {
            code: this.code,
            message: this.message,
            data: this.data,
        };
    }
}
//# sourceMappingURL=types.js.map