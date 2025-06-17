class ApiError extends Error {
  constructor(message, statusCode, errors = null, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.code = code || this.getErrorCode(statusCode);
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  getErrorCode(statusCode) {
    const errorCodes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      402: 'PAYMENT_REQUIRED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      405: 'METHOD_NOT_ALLOWED',
      406: 'NOT_ACCEPTABLE',
      408: 'REQUEST_TIMEOUT',
      409: 'CONFLICT',
      410: 'GONE',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      501: 'NOT_IMPLEMENTED',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT',
    };

    return errorCodes[statusCode] || 'ERROR';
  }
}

module.exports = ApiError;