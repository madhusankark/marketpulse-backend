const mongoose = require('mongoose');
const Redis = require('ioredis');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      logger.warn('MONGODB_URI not provided. DB features will operate in fallback mode.');
      return;
    }
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`Database connection error: ${error.message}`);
  }
};

const redisUrl = process.env.REDIS_URL || '';
const useTls = redisUrl.startsWith('rediss://');

const redisOptions = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  lazyConnect: true
};
if (useTls) {
  redisOptions.tls = { rejectUnauthorized: false };
}

const redis = redisUrl ? new Redis(redisUrl, redisOptions) : {
  get: async () => null,
  setex: async () => null,
  del: async () => null,
  status: 'disabled',
  connect: async () => {}
};

if (redisUrl) {
  redis.on('connect', () => logger.info('Redis Connected'));
  redis.on('error', (err) => logger.warn(`Redis Note: ${err.message}`));
}

module.exports = { connectDB, redis, logger };
