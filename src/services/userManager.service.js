/**
 * User Manager Service
 * Senior PM: Complete user management system with approval workflow
 */

const { User, JoinRequest } = require('../models');
const logger = require('../utils/logger');
const config = require('../config/config');

class UserManagerService {
  /**
   * Check if user is owner
   */
  static isOwner(userId) {
    return config.owners.includes(parseInt(userId));
  }
  
  /**
   * Get user by ID
   */
  static async getUserById(userId) {
    try {
      const user = await User.findByPk(userId);
      return user;
    } catch (error) {
      logger.error('Error getting user by ID', {
        userId,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Create or update user from Telegram data
   */
  static async createOrUpdateUser(telegramUser) {
    try {
      const userData = {
        id: telegramUser.id,
        username: telegramUser.username || null,
        first_name: telegramUser.first_name || null,
        last_name: telegramUser.last_name || null,
        language_code: telegramUser.language_code || null,
        is_bot: telegramUser.is_bot || false,
        last_activity: new Date()
      };
      
      // Check if user is owner
      if (this.isOwner(telegramUser.id)) {
        userData.role = 'owner';
        userData.status = 'approved';
        userData.approved_at = new Date();
      }
      
      const [user, created] = await User.findOrCreate({
        where: { id: telegramUser.id },
        defaults: userData
      });
      
      if (!created) {
        // Update existing user data
        await user.update({
          username: userData.username,
          first_name: userData.first_name,
          last_name: userData.last_name,
          language_code: userData.language_code,
          last_activity: new Date()
        });
      }
      
      logger.info(created ? 'User created' : 'User updated', {
        userId: telegramUser.id,
        username: telegramUser.username,
        status: user.status,
        role: user.role
      });
      
      return user;
    } catch (error) {
      logger.error('Error creating/updating user', {
        userId: telegramUser.id,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Create join request
   */
  static async createJoinRequest(telegramUser, message = null) {
    try {
      // Check if user already has pending request
      const existingRequest = await JoinRequest.findOne({
        where: {
          user_id: telegramUser.id,
          status: 'pending'
        }
      });
      
      if (existingRequest) {
        return { success: false, message: 'У вас уже есть заявка на рассмотрении' };
      }
      
      const joinRequest = await JoinRequest.create({
        user_id: telegramUser.id,
        username: telegramUser.username,
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name,
        message: message
      });
      
      logger.info('Join request created', {
        userId: telegramUser.id,
        username: telegramUser.username,
        requestId: joinRequest.id
      });
      
      return { success: true, request: joinRequest };
    } catch (error) {
      logger.error('Error creating join request', {
        userId: telegramUser.id,
        error: error.message
      });
      return { success: false, message: 'Ошибка создания заявки' };
    }
  }
  
  /**
   * Get pending join requests
   */
  static async getPendingRequests() {
    try {
      const requests = await JoinRequest.findAll({
        where: { status: 'pending' },
        order: [['created_at', 'ASC']],
        limit: 10
      });
      
      return requests;
    } catch (error) {
      logger.error('Error getting pending requests', {
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * Process join request (approve/reject)
   */
  static async processJoinRequest(requestId, action, ownerId) {
    try {
      const request = await JoinRequest.findByPk(requestId);
      if (!request || request.status !== 'pending') {
        return { success: false, message: 'Заявка не найдена или уже обработана' };
      }
      
      const user = await User.findByPk(request.user_id);
      if (!user) {
        return { success: false, message: 'Пользователь не найден' };
      }
      
      if (action === 'approve') {
        // Approve user
        await user.update({
          status: 'approved',
          approved_by: ownerId,
          approved_at: new Date()
        });
        
        await request.update({
          status: 'approved',
          processed_by: ownerId,
          processed_at: new Date()
        });
        
        logger.info('User approved', {
          userId: request.user_id,
          approvedBy: ownerId,
          requestId
        });
        
        return { 
          success: true, 
          message: 'Пользователь одобрен',
          user: user,
          action: 'approved'
        };
        
      } else if (action === 'reject') {
        // Reject request
        await user.update({
          status: 'rejected',
          rejected_at: new Date()
        });
        
        await request.update({
          status: 'rejected',
          processed_by: ownerId,
          processed_at: new Date()
        });
        
        logger.info('User rejected', {
          userId: request.user_id,
          rejectedBy: ownerId,
          requestId
        });
        
        return { 
          success: true, 
          message: 'Пользователь отклонен',
          user: user,
          action: 'rejected'
        };
      }
      
      return { success: false, message: 'Неверное действие' };
      
    } catch (error) {
      logger.error('Error processing join request', {
        requestId,
        action,
        ownerId,
        error: error.message
      });
      return { success: false, message: 'Ошибка обработки заявки' };
    }
  }
  
  /**
   * Ban user
   */
  static async banUser(userId, ownerId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        return { success: false, message: 'Пользователь не найден' };
      }
      
      if (user.role === 'owner') {
        return { success: false, message: 'Нельзя заблокировать владельца' };
      }
      
      await user.update({
        status: 'banned',
        updated_at: new Date()
      });
      
      logger.warn('User banned', {
        userId,
        bannedBy: ownerId,
        username: user.username
      });
      
      return { 
        success: true, 
        message: 'Пользователь заблокирован',
        user: user
      };
      
    } catch (error) {
      logger.error('Error banning user', {
        userId,
        ownerId,
        error: error.message
      });
      return { success: false, message: 'Ошибка блокировки пользователя' };
    }
  }
  
  /**
   * Unban user
   */
  static async unbanUser(userId, ownerId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        return { success: false, message: 'Пользователь не найден' };
      }
      
      await user.update({
        status: 'approved',
        approved_by: ownerId,
        approved_at: new Date(),
        updated_at: new Date()
      });
      
      logger.info('User unbanned', {
        userId,
        unbannedBy: ownerId,
        username: user.username
      });
      
      return { 
        success: true, 
        message: 'Пользователь разблокирован',
        user: user
      };
      
    } catch (error) {
      logger.error('Error unbanning user', {
        userId,
        ownerId,
        error: error.message
      });
      return { success: false, message: 'Ошибка разблокировки пользователя' };
    }
  }
  
  /**
   * Get approved users for broadcasting
   */
  static async getApprovedUsers() {
    try {
      const users = await User.findAll({
        where: { 
          status: 'approved'
        },
        attributes: ['id', 'username', 'first_name', 'last_name', 'language_code'],
        order: [['last_activity', 'DESC']]
      });
      
      return users;
    } catch (error) {
      logger.error('Error getting approved users', {
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * Get user statistics
   */
  static async getUserStats() {
    try {
      const [
        totalUsers,
        pendingUsers,
        approvedUsers,
        rejectedUsers,
        bannedUsers,
        owners,
        pendingRequests
      ] = await Promise.all([
        User.count(),
        User.count({ where: { status: 'pending' } }),
        User.count({ where: { status: 'approved' } }),
        User.count({ where: { status: 'rejected' } }),
        User.count({ where: { status: 'banned' } }),
        User.count({ where: { role: 'owner' } }),
        JoinRequest.count({ where: { status: 'pending' } })
      ]);
      
      return {
        total: totalUsers,
        pending: pendingUsers,
        approved: approvedUsers,
        rejected: rejectedUsers,
        banned: bannedUsers,
        owners: owners,
        pendingRequests: pendingRequests
      };
    } catch (error) {
      logger.error('Error getting user stats', {
        error: error.message
      });
      return {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        banned: 0,
        owners: 0,
        pendingRequests: 0
      };
    }
  }
  
  /**
   * Search users
   */
  static async searchUsers(query, limit = 20) {
    try {
      const { Op } = require('sequelize');
      
      const users = await User.findAll({
        where: {
          [Op.or]: [
            { username: { [Op.iLike]: `%${query}%` } },
            { first_name: { [Op.iLike]: `%${query}%` } },
            { last_name: { [Op.iLike]: `%${query}%` } },
            { id: isNaN(query) ? -1 : parseInt(query) }
          ]
        },
        limit: limit,
        order: [['last_activity', 'DESC']]
      });
      
      return users;
    } catch (error) {
      logger.error('Error searching users', {
        query,
        error: error.message
      });
      return [];
    }
  }
}

module.exports = UserManagerService;