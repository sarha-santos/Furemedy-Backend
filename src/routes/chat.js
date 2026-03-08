// =====================================================================
// Chat Routes - RESTful API for Chat Session and Message Management
// =====================================================================
// This module handles all chat-related endpoints including:
// - Creating and retrieving chat sessions
// - Managing chat messages
// - Tracking token usage per session
// - Updating session titles and metadata

const express = require('express');
const router = express.Router();
const pgPool = require('../config/db');
const jwt = require('jsonwebtoken');

/**
 * Middleware: Verify JWT token from Authorization header
 * Token format: "Bearer <token>"
 */
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.user?.id;

    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Invalid token payload' });
    }

    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ========================================
// POST /api/chat/sessions
// Create a new chat session
// ========================================
/**
 * @param {number} user_id - The user creating the session
 * @param {string} title - Optional title for the session (default: "New Chat")
 * @param {number} max_token_limit - Maximum tokens allowed (default: 1000)
 * 
 * @returns {object} New chat session with id, title, created_at, total_tokens_used
 */
router.post('/sessions', verifyToken, async (req, res) => {
  try {
    const { title, max_token_limit } = req.body;
    const userId = req.userId;

    // Validate input
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    // Create new session with default values
    const query = `
      INSERT INTO chat_sessions (user_id, title, max_token_limit)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, title, created_at, updated_at, total_tokens_used, max_token_limit, is_archived;
    `;

    const values = [
      userId,
      title || 'New Chat',
      max_token_limit || 1000
    ];

    const result = await pgPool.query(query, values);
    const session = result.rows[0];

    console.log(`✅ Chat session created for user ${userId}: ${session.id}`);
    
    res.status(201).json({
      success: true,
      message: 'Chat session created successfully',
      data: session
    });
  } catch (err) {
    console.error('❌ Error creating chat session:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create chat session',
      error: err.message
    });
  }
});

// ========================================
// GET /api/chat/sessions
// Get all chat sessions for the current user
// ========================================
/**
 * @query {boolean} include_archived - Include archived sessions (default: false)
 * @query {number} limit - Number of sessions to return (default: 50)
 * @query {number} offset - Pagination offset (default: 0)
 * 
 * @returns {array} List of chat sessions ordered by most recent
 */
router.get('/sessions', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { include_archived, limit = 50, offset = 0 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Build dynamic query based on filters
    let whereClause = 'user_id = $1';
    const params = [userId];

    if (include_archived !== 'true') {
      whereClause += ' AND is_archived = FALSE';
    }

    const query = `
      SELECT 
        id, 
        user_id, 
        title, 
        created_at, 
        updated_at, 
        total_tokens_used, 
        max_token_limit, 
        is_archived,
        (SELECT COUNT(*) FROM chat_messages WHERE session_id = chat_sessions.id) as message_count
      FROM chat_sessions
      WHERE ${whereClause}
      ORDER BY updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    params.push(limit, offset);
    const result = await pgPool.query(query, params);

    if (result.rows.length === 0) {
      const client = await pgPool.connect();

      try {
        await client.query('BEGIN');

        const createdSessionResult = await client.query(
          `
            INSERT INTO chat_sessions (user_id, title, max_token_limit)
            VALUES ($1, $2, $3)
            RETURNING id, user_id, title, created_at, updated_at, total_tokens_used, max_token_limit, is_archived;
          `,
          [userId, 'New Chat', 1000]
        );

        const createdSession = createdSessionResult.rows[0];

        await client.query(
          `
            INSERT INTO chat_messages (session_id, role, content, tokens_used)
            VALUES ($1, 'assistant', $2, 0);
          `,
          [createdSession.id, 'Good morning, friend 👋 How can I help you and your pet today?']
        );

        await client.query('COMMIT');

        return res.status(200).json({
          success: true,
          data: [{ ...createdSession, message_count: 1 }],
          count: 1,
          created_default_session: true
        });
      } catch (bootstrapErr) {
        await client.query('ROLLBACK');
        throw bootstrapErr;
      } finally {
        client.release();
      }
    }

    console.log(`✅ Retrieved ${result.rows.length} sessions for user ${userId}`);

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('❌ Error fetching chat sessions:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat sessions',
      error: err.message
    });
  }
});

// ========================================
// GET /api/chat/sessions/:sessionId
// Get a specific chat session with all messages
// ========================================
/**
 * @param {number} sessionId - The session ID
 * 
 * @returns {object} Session details with full message history
 */
router.get('/sessions/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId;

    // Fetch session details
    const sessionQuery = `
      SELECT 
        id, 
        user_id, 
        title, 
        created_at, 
        updated_at, 
        total_tokens_used, 
        max_token_limit, 
        is_archived
      FROM chat_sessions
      WHERE id = $1 AND user_id = $2;
    `;

    const sessionResult = await pgPool.query(sessionQuery, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }

    const session = sessionResult.rows[0];

    // Fetch all messages for this session
    const messagesQuery = `
      SELECT 
        id,
        session_id,
        role,
        content,
        tokens_used,
        created_at
      FROM chat_messages
      WHERE session_id = $1
      ORDER BY created_at ASC;
    `;

    const messagesResult = await pgPool.query(messagesQuery, [sessionId]);

    console.log(`✅ Retrieved session ${sessionId} with ${messagesResult.rows.length} messages`);

    res.status(200).json({
      success: true,
      data: {
        ...session,
        messages: messagesResult.rows
      }
    });
  } catch (err) {
    console.error('❌ Error fetching chat session:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat session',
      error: err.message
    });
  }
});

// ========================================
// POST /api/chat/messages
// Add a message to a chat session
// ========================================
/**
 * @param {number} session_id - The session ID
 * @param {string} role - "user" or "assistant"
 * @param {string} content - The message content
 * @param {number} tokens_used - Number of tokens consumed by this message
 * 
 * @returns {object} The newly created message
 */
router.post('/messages', verifyToken, async (req, res) => {
  try {
    const { session_id, role, content, tokens_used } = req.body;
    const userId = req.userId;

    // Validate input
    if (!session_id || !role || !content) {
      return res.status(400).json({
        success: false,
        message: 'session_id, role, and content are required'
      });
    }

    if (!['user', 'assistant'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'role must be "user" or "assistant"'
      });
    }

    // Verify the session belongs to the user
    const sessionCheck = await pgPool.query(
      'SELECT id, total_tokens_used, max_token_limit FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [session_id, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }

    const session = sessionCheck.rows[0];
    const tokenCount = tokens_used || 0;
    const newTotalTokens = session.total_tokens_used + tokenCount;

    // Check if adding this message would exceed the limit
    if (newTotalTokens > session.max_token_limit && role === 'user') {
      return res.status(403).json({
        success: false,
        message: 'Token limit exceeded',
        current_tokens: session.total_tokens_used,
        max_tokens: session.max_token_limit,
        tokens_requested: tokenCount
      });
    }

    // Insert the message
    const messageQuery = `
      INSERT INTO chat_messages (session_id, role, content, tokens_used)
      VALUES ($1, $2, $3, $4)
      RETURNING id, session_id, role, content, tokens_used, created_at;
    `;

    const messageResult = await pgPool.query(messageQuery, [
      session_id,
      role,
      content,
      tokenCount
    ]);

    // Update session's total tokens and updated_at timestamp
    const updateSessionQuery = `
      UPDATE chat_sessions
      SET total_tokens_used = total_tokens_used + $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING total_tokens_used, updated_at;
    `;

    await pgPool.query(updateSessionQuery, [tokenCount, session_id]);

    const message = messageResult.rows[0];

    console.log(`✅ Message added to session ${session_id}`);

    res.status(201).json({
      success: true,
      message: 'Message added successfully',
      data: message
    });
  } catch (err) {
    console.error('❌ Error adding message:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to add message',
      error: err.message
    });
  }
});

// ========================================
// GET /api/chat/messages/:sessionId
// Get all messages for a session (with pagination)
// ========================================
/**
 * @param {number} sessionId - The session ID
 * @query {number} limit - Number of messages to return (default: 100)
 * @query {number} offset - Pagination offset (default: 0)
 * 
 * @returns {array} Messages ordered by creation time
 */
router.get('/messages/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 100, offset = 0 } = req.query;
    const userId = req.userId;

    // Verify ownership of session
    const sessionCheck = await pgPool.query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }

    // Fetch messages with pagination
    const query = `
      SELECT 
        id,
        session_id,
        role,
        content,
        tokens_used,
        created_at
      FROM chat_messages
      WHERE session_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3;
    `;

    const result = await pgPool.query(query, [sessionId, limit, offset]);

    console.log(`✅ Retrieved ${result.rows.length} messages for session ${sessionId}`);

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('❌ Error fetching messages:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
      error: err.message
    });
  }
});

// ========================================
// PATCH /api/chat/sessions/:sessionId
// Update a chat session (title, archive status)
// ========================================
/**
 * @param {number} sessionId - The session ID
 * @body {string} title - New title (optional)
 * @body {boolean} is_archived - Archive status (optional)
 * 
 * @returns {object} Updated session
 */
router.patch('/sessions/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, is_archived } = req.body;
    const userId = req.userId;

    // Build dynamic update query
    const updates = [];
    const values = [sessionId, userId];
    let paramIndex = 3;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(title);
      paramIndex++;
    }

    if (is_archived !== undefined) {
      updates.push(`is_archived = $${paramIndex}`);
      values.push(is_archived);
      paramIndex++;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    const query = `
      UPDATE chat_sessions
      SET ${updates.join(', ')}
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, title, created_at, updated_at, total_tokens_used, max_token_limit, is_archived;
    `;

    const result = await pgPool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }

    console.log(`✅ Updated chat session ${sessionId}`);

    res.status(200).json({
      success: true,
      message: 'Session updated successfully',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('❌ Error updating session:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update session',
      error: err.message
    });
  }
});

// ========================================
// DELETE /api/chat/sessions/:sessionId
// Delete a chat session and all its messages
// ========================================
/**
 * @param {number} sessionId - The session ID
 * 
 * @returns {object} Success message
 */
router.delete('/sessions/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId;

    // Verify ownership and delete
    const query = `
      DELETE FROM chat_sessions
      WHERE id = $1 AND user_id = $2
      RETURNING id;
    `;

    const result = await pgPool.query(query, [sessionId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }

    console.log(`✅ Deleted chat session ${sessionId}`);

    res.status(200).json({
      success: true,
      message: 'Chat session deleted successfully'
    });
  } catch (err) {
    console.error('❌ Error deleting session:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete session',
      error: err.message
    });
  }
});

// ========================================
// DELETE /api/chat/messages/:messageId
// Delete a specific message from a session
// ========================================
/**
 * @param {number} messageId - The message ID
 * 
 * @returns {object} Success message and refunded tokens
 */
router.delete('/messages/:messageId', verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.userId;

    // Fetch message to get session_id and tokens
    const messageQuery = `
      SELECT cm.id, cm.session_id, cm.tokens_used
      FROM chat_messages cm
      JOIN chat_sessions cs ON cm.session_id = cs.id
      WHERE cm.id = $1 AND cs.user_id = $2;
    `;

    const messageResult = await pgPool.query(messageQuery, [messageId, userId]);

    if (messageResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    const { session_id, tokens_used } = messageResult.rows[0];

    // Delete the message
    await pgPool.query('DELETE FROM chat_messages WHERE id = $1', [messageId]);

    // Refund tokens to the session
    await pgPool.query(
      'UPDATE chat_sessions SET total_tokens_used = total_tokens_used - $1 WHERE id = $2',
      [tokens_used, session_id]
    );

    console.log(`✅ Deleted message ${messageId}, refunded ${tokens_used} tokens`);

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully',
      tokens_refunded: tokens_used
    });
  } catch (err) {
    console.error('❌ Error deleting message:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: err.message
    });
  }
});

// ========================================
// GET /api/chat/stats
// Get token usage statistics for current user
// ========================================
/**
 * @returns {object} Token usage statistics and session summary
 */
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;

    // Get total tokens used across all sessions
    const statsQuery = `
      SELECT 
        COUNT(*) as total_sessions,
        COALESCE(SUM(total_tokens_used), 0) as total_tokens_used,
        COALESCE(AVG(total_tokens_used), 0) as avg_tokens_per_session,
        MAX(max_token_limit) as highest_limit
      FROM chat_sessions
      WHERE user_id = $1 AND is_archived = FALSE;
    `;

    const result = await pgPool.query(statsQuery, [userId]);

    console.log(`✅ Retrieved token stats for user ${userId}`);

    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('❌ Error fetching stats:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: err.message
    });
  }
});

module.exports = router;
