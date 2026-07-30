const { logger } = require('../config/db');
const SystemLog = require('../models/SystemLog');

const errorHandler = async (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  logger.error(`${err.name}: ${err.message}`, { stack: err.stack });

  if (err.name === 'CastError') {
    error.message = 'Resource not found';
    error.statusCode = 404;
  }

  if (err.code === 11000) {
    error.message = 'Duplicate field value entered';
    error.statusCode = 400;
  }

  if (err.name === 'ValidationError') {
    error.message = Object.values(err.errors).map(val => val.message).join(', ');
    error.statusCode = 400;
  }

  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token';
    error.statusCode = 401;
  }

  if (err.name === 'TokenExpiredError') {
    error.message = 'Token expired';
    error.statusCode = 401;
  }

  try {
    await SystemLog.create({
      level: error.statusCode >= 500 ? 'error' : 'warning',
      action: 'api_error',
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      details: { error: error.message, path: req.originalUrl, method: req.method },
      statusCode: error.statusCode || 500
    });
  } catch (logErr) {
    logger.error('Failed to log error:', logErr.message);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error'
  });
};

module.exports = errorHandler;
