const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const cron = require('node-cron');
require('dotenv').config();

const { connectDB, redis, logger } = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const MarketDataService = require('./services/marketDataService');
const YahooProvider = require('./services/yahooProvider');
const AlertEngine = require('./services/alertEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5000', process.env.CLIENT_URL || '*'],
    methods: ['GET', 'POST']
  },
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

module.exports = { io };

app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

if (process.env.NODE_ENV !== 'development') {
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
    message: { success: false, message: 'Too many requests, please try again later' }
  });
  app.use('/api/', limiter);
}

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MarketPulse API',
      version: '1.0.0',
      description: 'Real-Time Indian Stock Monitoring & Analytics Platform API'
    },
    servers: [{ url: `http://localhost:${process.env.PORT || 5000}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    }
  },
  apis: ['./routes/*.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/stocks', require('./routes/stocks'));
app.use('/api/watchlists', require('./routes/watchlist'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/portfolio', require('./routes/portfolio'));

app.get('/api/health', async (req, res) => {
  const redisStatus = redis.status === 'ready' ? 'connected' : 'disconnected';
  res.json({
    success: true,
    data: {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: { database: 'connected', redis: redisStatus }
    }
  });
});

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('join', (room) => {
    socket.join(room);
    logger.debug(`Socket ${socket.id} joined room: ${room}`);
  });

  socket.on('leave', (room) => {
    socket.leave(room);
  });

  socket.on('subscribeQuote', (symbol) => {
    socket.join(`quote:${symbol}`);
    subscribedSymbols.add(symbol);
  });

  socket.on('unsubscribeQuote', (symbol) => {
    socket.leave(`quote:${symbol}`);
    subscribedSymbols.delete(symbol);
  });

  socket.on('disconnect', () => {
    logger.debug(`Client disconnected: ${socket.id}`);
  });
});

const subscribedSymbols = new Set();

let priceUpdateInterval;

async function startPriceUpdates() {
  const updatePrices = async () => {
    try {
      const [indices] = await Promise.all([
        MarketDataService.getMarketIndices().catch(() => [])
      ]);

      for (const sym of subscribedSymbols) {
        const quote = await MarketDataService.getLiveQuote(sym).catch(() => null);
        if (quote) {
          io.to(`quote:${quote.symbol}`).emit('priceUpdate', quote);
        }
      }

      if (indices.length > 0) {
        io.emit('marketUpdate', {
          timestamp: new Date().toISOString(),
          indices
        });
      }
    } catch (error) {
      logger.error('Price update error:', error.message);
    }
  };

  await updatePrices().catch(() => {});

  priceUpdateInterval = setInterval(updatePrices, 60000);
  logger.info('Real-time price updates started (60s interval)');
}

cron.schedule('*/5 * * * *', async () => {
  try {
    await AlertEngine.evaluateAlerts();
  } catch (error) {
    logger.error('Cron alert evaluation error:', error.message);
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    await redis.connect().catch(() => {});

    const flushKeys = ['quotes:all', 'gainers', 'losers', 'most_active', 'indices', 'sectors'];
    Promise.allSettled(flushKeys.map(k => redis.del(k))).then(() => {
      logger.info('Stale market data caches flushed on startup');
    }).catch(() => {});

    server.listen(PORT, () => {
      logger.info(`MarketPulse server running on port ${PORT}`);
      logger.info(`API docs available at http://localhost:${PORT}/api-docs`);
      startPriceUpdates();
    });
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err.message);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  clearInterval(priceUpdateInterval);
  server.close(() => process.exit(0));
});

start();
