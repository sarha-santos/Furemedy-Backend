-- ==============================================================
-- Migration: Create Chat Session and Message Tables
-- ==============================================================
-- This migration adds support for storing chat conversations
-- with token usage tracking per session.

-- ===========================
-- Chat Sessions Table
-- ===========================
-- Stores information about each chat conversation
-- - Linked to a user
-- - Tracks total token usage
-- - Records when the session was created/updated

CREATE TABLE IF NOT EXISTS chat_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  total_tokens_used INTEGER DEFAULT 0,
  max_token_limit INTEGER DEFAULT 1000,
  is_archived BOOLEAN DEFAULT FALSE,
  
  -- Foreign key constraint to users table
  CONSTRAINT fk_chat_sessions_user_id 
    FOREIGN KEY (user_id) 
    REFERENCES users(id) 
    ON DELETE CASCADE
);

-- Create index for faster user-based queries
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id 
  ON chat_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at 
  ON chat_sessions(created_at DESC);


-- ===========================
-- Chat Messages Table
-- ===========================
-- Stores individual messages within a chat session
-- - Linked to a chat session
-- - Tracks sender (user or assistant)
-- - Records token usage for each message

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign key constraint to chat_sessions table
  CONSTRAINT fk_chat_messages_session_id 
    FOREIGN KEY (session_id) 
    REFERENCES chat_sessions(id) 
    ON DELETE CASCADE
);

-- Create indexes for efficient message retrieval
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id 
  ON chat_messages(session_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at 
  ON chat_messages(created_at ASC);


-- ===========================
-- Token Usage Statistics Table (Optional)
-- ===========================
-- Stores daily token usage statistics for analytics
-- Useful for monitoring token consumption trends

CREATE TABLE IF NOT EXISTS token_usage_stats (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  usage_date DATE DEFAULT CURRENT_DATE,
  tokens_consumed INTEGER DEFAULT 0,
  messages_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_token_usage_stats_user_id 
    FOREIGN KEY (user_id) 
    REFERENCES users(id) 
    ON DELETE CASCADE,
    
  -- Ensure only one record per user per day
  CONSTRAINT unique_user_date 
    UNIQUE (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_token_usage_stats_user_id 
  ON token_usage_stats(user_id);
