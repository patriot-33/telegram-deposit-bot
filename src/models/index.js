/**
 * Database Models
 * Senior PM: PostgreSQL models with Sequelize ORM
 */

const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config/config');
const logger = require('../utils/logger');

// Initialize Sequelize
const sequelize = new Sequelize(config.database.url, {
  dialect: 'postgres',
  logging: (msg) => logger.debug('Database query', { query: msg }),
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: {
    ssl: config.env === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});

// User Model
const User = sequelize.define('User', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    comment: 'Telegram User ID'
  },
  username: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Telegram username without @'
  },
  first_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'User first name'
  },
  last_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'User last name'
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'banned'),
    defaultValue: 'pending',
    allowNull: false,
    comment: 'User status in bot'
  },
  role: {
    type: DataTypes.ENUM('user', 'owner'),
    defaultValue: 'user',
    allowNull: false,
    comment: 'User role'
  },
  language_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: 'User language preference'
  },
  is_bot: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Is this user a bot'
  },
  approved_by: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'ID of owner who approved user'
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When user was approved'
  },
  rejected_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When user was rejected'
  },
  last_activity: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment: 'Last bot interaction'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false
  }
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['status'] },
    { fields: ['role'] },
    { fields: ['username'] },
    { fields: ['created_at'] }
  ]
});

// Join Request Model
const JoinRequest = sequelize.define('JoinRequest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: 'Telegram User ID'
  },
  username: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Username at time of request'
  },
  first_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'First name at time of request'
  },
  last_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Last name at time of request'
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional message from user'
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
    allowNull: false
  },
  processed_by: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'Owner ID who processed request'
  },
  processed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false
  }
}, {
  tableName: 'join_requests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['created_at'] }
  ]
});

// Notification Log Model
const NotificationLog = sequelize.define('NotificationLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  type: {
    type: DataTypes.ENUM('deposit', 'system', 'error'),
    allowNull: false
  },
  recipient_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of users message was sent to'
  },
  success_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of successful deliveries'
  },
  failed_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of failed deliveries'
  },
  message_text: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Message content sent'
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Additional data (postback info, etc.)'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false
  }
}, {
  tableName: 'notification_logs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['type'] },
    { fields: ['created_at'] }
  ]
});

// Model Associations
User.hasMany(JoinRequest, { foreignKey: 'user_id', as: 'joinRequests' });
JoinRequest.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Database connection and sync
async function initializeDatabase() {
  try {
    logger.info('🔄 Connecting to PostgreSQL database...');
    
    // Test connection
    await sequelize.authenticate();
    logger.info('✅ Database connection established successfully');
    
    // Sync models
    await sequelize.sync({ alter: config.env === 'development' });
    logger.info('✅ Database models synchronized');
    
    // Create owners if they don't exist
    const ownerIds = config.owners;
    for (const ownerId of ownerIds) {
      const [owner, created] = await User.findOrCreate({
        where: { id: ownerId },
        defaults: {
          id: ownerId,
          status: 'approved',
          role: 'owner',
          first_name: 'Owner',
          approved_at: new Date()
        }
      });
      
      if (created) {
        logger.info(`✅ Owner created`, { userId: ownerId });
      }
    }
    
    logger.info('🎯 Database initialization completed');
    return true;
  } catch (error) {
    logger.error('❌ Database initialization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Health check function
async function checkDatabaseHealth() {
  try {
    await sequelize.authenticate();
    const result = await sequelize.query('SELECT NOW() as current_time');
    
    return {
      healthy: true,
      timestamp: result[0][0].current_time,
      connection: 'active'
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      connection: 'failed'
    };
  }
}

module.exports = {
  sequelize,
  User,
  JoinRequest,
  NotificationLog,
  initializeDatabase,
  checkDatabaseHealth
};