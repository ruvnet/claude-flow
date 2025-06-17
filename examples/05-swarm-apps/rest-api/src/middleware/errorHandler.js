// Global error handling middleware
const errorHandler = (err, req, res, next) => {
  // Log error for debugging
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Default error response
  let status = err.status || 500;
  let message = err.message || 'Internal Server Error';
  let errors = null;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation Error';
    errors = err.errors;
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid ID format';
  } else if (err.code === 'ECONNREFUSED') {
    status = 503;
    message = 'Service Unavailable';
  }

  // Send error response
  const errorResponse = {
    success: false,
    error: {
      message,
      status,
      timestamp: new Date().toISOString()
    }
  };

  // Include additional error details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
    if (errors) errorResponse.error.details = errors;
  }

  res.status(status).json(errorResponse);
};

module.exports = errorHandler;