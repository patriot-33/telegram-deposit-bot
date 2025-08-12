/**
 * Validation Utilities
 * Senior PM: Comprehensive validation helpers
 */

const Joi = require('joi');
const logger = require('./logger');

/**
 * Postback validation schemas
 */
const schemas = {
  postback: Joi.object({
    subid: Joi.string().trim().min(1).max(100).required()
      .messages({
        'string.empty': 'Subid is required',
        'string.min': 'Subid must not be empty',
        'string.max': 'Subid too long'
      }),
    
    status: Joi.string().trim().valid('sale', 'lead', 'click', 'impression').required()
      .messages({
        'any.only': 'Status must be one of: sale, lead, click, impression'
      }),
    
    payout: Joi.number().min(0).max(999999.99).optional()
      .messages({
        'number.min': 'Payout must be positive',
        'number.max': 'Payout too large'
      }),
    
    geo: Joi.string().trim().length(2).uppercase().optional()
      .messages({
        'string.length': 'GEO must be 2 characters'
      })
  }).unknown(true),
  
  clickData: Joi.object({
    id: Joi.string().required(),
    campaign_id: Joi.number().positive().required(),
    offer_id: Joi.number().positive().required(),
    traffic_source_id: Joi.number().positive().required(),
    sub_id_1: Joi.string().allow('', null).optional(),
    sub_id_2: Joi.string().allow('', null).optional(),
    sub_id_4: Joi.string().allow('', null).optional(),
    country: Joi.string().length(2).optional()
  }).unknown(true),
  
  depositData: Joi.object({
    subid1: Joi.string().required(),
    geo: Joi.string().required(),
    payout: Joi.number().min(0).required(),
    traffic_source_name: Joi.string().required(),
    offer_name: Joi.string().required(),
    campaign_name: Joi.string().required(),
    subid2: Joi.string().required(),
    subid4: Joi.string().required(),
    timestamp: Joi.string().isoDate().required(),
    traffic_source_id: Joi.number().positive().required()
  }).unknown(true)
};

/**
 * Validation helper class
 */
class ValidationHelper {
  /**
   * Validate postback data
   */
  static validatePostback(data) {
    try {
      const { error, value } = schemas.postback.validate(data, {
        abortEarly: false,
        stripUnknown: false,
        convert: true
      });
      
      if (error) {
        const errorMessages = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context.value
        }));
        
        logger.warn('Postback validation failed', {
          errors: errorMessages,
          data
        });
        
        return {
          valid: false,
          errors: errorMessages,
          data: null
        };
      }
      
      logger.debug('Postback validation passed', { data: value });
      
      return {
        valid: true,
        errors: null,
        data: value
      };
    } catch (error) {
      logger.error('Postback validation error', {
        error: error.message,
        data
      });
      
      return {
        valid: false,
        errors: [{ field: 'general', message: 'Validation error', value: null }],
        data: null
      };
    }
  }
  
  /**
   * Validate Keitaro click data
   */
  static validateClickData(data) {
    try {
      const { error, value } = schemas.clickData.validate(data, {
        abortEarly: false,
        stripUnknown: false
      });
      
      if (error) {
        const errorMessages = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
        
        logger.warn('Click data validation failed', {
          errors: errorMessages,
          clickId: data?.id
        });
        
        return {
          valid: false,
          errors: errorMessages,
          data: null
        };
      }
      
      return {
        valid: true,
        errors: null,
        data: value
      };
    } catch (error) {
      logger.error('Click data validation error', {
        error: error.message,
        clickId: data?.id
      });
      
      return {
        valid: false,
        errors: [{ field: 'general', message: 'Validation error' }],
        data: null
      };
    }
  }
  
  /**
   * Validate deposit notification data
   */
  static validateDepositData(data) {
    try {
      const { error, value } = schemas.depositData.validate(data, {
        abortEarly: false,
        stripUnknown: false
      });
      
      if (error) {
        const errorMessages = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
        
        logger.warn('Deposit data validation failed', {
          errors: errorMessages,
          subid1: data?.subid1
        });
        
        return {
          valid: false,
          errors: errorMessages,
          data: null
        };
      }
      
      return {
        valid: true,
        errors: null,
        data: value
      };
    } catch (error) {
      logger.error('Deposit data validation error', {
        error: error.message,
        subid1: data?.subid1
      });
      
      return {
        valid: false,
        errors: [{ field: 'general', message: 'Validation error' }],
        data: null
      };
    }
  }
  
  /**
   * Sanitize string input
   */
  static sanitizeString(input, maxLength = 1000) {
    try {
      if (typeof input !== 'string') {
        return String(input || '').trim();
      }
      
      return input
        .trim()
        .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '') // Remove control characters
        .substring(0, maxLength);
    } catch (error) {
      logger.error('String sanitization error', {
        error: error.message,
        input: typeof input
      });
      return '';
    }
  }
  
  /**
   * Validate and sanitize email
   */
  static isValidEmail(email) {
    try {
      const emailSchema = Joi.string().email().required();
      const { error } = emailSchema.validate(email);
      return !error;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Validate IP address
   */
  static isValidIP(ip) {
    try {
      const ipSchema = Joi.string().ip().required();
      const { error } = ipSchema.validate(ip);
      return !error;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Validate traffic source ID
   */
  static isValidTrafficSourceId(id) {
    try {
      const sourceId = parseInt(id);
      return !isNaN(sourceId) && sourceId > 0 && sourceId < 1000;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Validate payout amount
   */
  static isValidPayout(payout) {
    try {
      const amount = parseFloat(payout);
      return !isNaN(amount) && amount >= 0 && amount <= 999999.99;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Validate GEO code
   */
  static isValidGeo(geo) {
    try {
      if (typeof geo !== 'string') return false;
      
      const cleanGeo = geo.trim().toUpperCase();
      return cleanGeo.length === 2 && /^[A-Z]{2}$/.test(cleanGeo);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Create validation error response
   */
  static createErrorResponse(field, message, value = null) {
    return {
      valid: false,
      errors: [{
        field,
        message,
        value
      }],
      data: null
    };
  }
  
  /**
   * Create success response
   */
  static createSuccessResponse(data) {
    return {
      valid: true,
      errors: null,
      data
    };
  }
}

module.exports = {
  ValidationHelper,
  schemas
};