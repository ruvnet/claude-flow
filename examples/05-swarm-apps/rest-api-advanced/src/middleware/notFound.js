const ApiError = require('../utils/ApiError');

const notFound = (req, res, next) => {
  const error = new ApiError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

module.exports = { notFound };