const Notification = require('../models/Notification');
const { logger } = require('../config/db');

class NotificationService {
  static async create(userId, { type, title, message, data = {} }) {
    try {
      const notification = await Notification.create({
        user: userId,
        type,
        title,
        message,
        data
      });

      const io = require('../index').io;
      if (io) {
        io.to(`user:${userId}`).emit('notification', {
          id: notification._id,
          type,
          title,
          message,
          data,
          isRead: false,
          createdAt: notification.createdAt
        });
      }

      return notification;
    } catch (error) {
      logger.error('Notification creation error:', error.message);
      throw error;
    }
  }

  static async getUserNotifications(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
    const skip = (page - 1) * limit;
    const query = { user: userId };
    if (unreadOnly) query.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(query),
      Notification.countDocuments({ user: userId, isRead: false })
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  static async markAsRead(userId, notificationId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, user: userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
  }

  static async markAllAsRead(userId) {
    return Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );
  }

  static async deleteNotification(userId, notificationId) {
    return Notification.findOneAndDelete({ _id: notificationId, user: userId });
  }

  static async getUnreadCount(userId) {
    return Notification.countDocuments({ user: userId, isRead: false });
  }

  static async createSystemNotification(userId, title, message) {
    return this.create(userId, { type: 'system', title, message });
  }

  static async createPriceAlertNotification(userId, symbol, price, change) {
    return this.create(userId, {
      type: 'price_update',
      title: `Price Update: ${symbol}`,
      message: `${symbol} is now at ₹${price} (${change > 0 ? '+' : ''}${change}%)`,
      data: { symbol, price, change }
    });
  }
}

module.exports = NotificationService;
