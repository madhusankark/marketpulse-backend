require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const { logger } = require('./config/db');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB for seeding');

    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@marketpulse.com';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    const userEmail = process.env.SEED_USER_EMAIL || 'user@marketpulse.com';
    const userPassword = process.env.SEED_USER_PASSWORD || 'user123';

    const adminExists = await User.findOne({ email: adminEmail });
    if (!adminExists) {
      await User.create({
        name: 'Admin',
        email: adminEmail,
        password: adminPassword,
        role: 'admin'
      });
      logger.info(`Admin user created: ${adminEmail}`);
    }

    const userExists = await User.findOne({ email: userEmail });
    if (!userExists) {
      await User.create({
        name: 'Demo User',
        email: userEmail,
        password: userPassword,
        role: 'user'
      });
      logger.info(`Demo user created: ${userEmail}`);
    }

    logger.info('Seeding completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding error:', error.message);
    process.exit(1);
  }
}

seed();
