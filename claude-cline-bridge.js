// claude-cline-bridge.js - Minimal communication bridge between Claude and Cline
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// Redirect logs to stderr to avoid interfering with JSON protocol when used via MCP
if (process.stdout.isTTY === false && process.stderr.isTTY === false) {
  // Only redirect when running in a non-TTY environment (like when launched by Claude/Cline)
  const originalConsoleLog = console.log;
  console.log = function() {
    console.error.apply(console, arguments);
  };
}

// Configuration
const PORT = 2612;
const START_TIME = new Date();

// Create Express app
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(cors());

// Simple message queues
const messages = {
  claude: [], // Messages for Claude to retrieve
  cline: []   // Messages for Cline to retrieve
};

// Helper for logging with timestamps
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

//------------------------------------------
// MESSAGE ROUTES
//------------------------------------------

// POST /claude/message - Claude sends a message to Cline
app.post('/claude/message', (req, res) => {
  const message = {
    content: req.body.content,
    type: req.body.type || 'text',
    timestamp: new Date().toISOString()
  };
  
  log(`Claude -> Cline: ${message.type} message`);
  messages.cline.push(message);
  
  res.json({ success: true });
});

// POST /cline/message - Cline sends a message to Claude
app.post('/cline/message', (req, res) => {
  const message = {
    content: req.body.content,
    type: req.body.type || 'text',
    timestamp: new Date().toISOString()
  };
  
  log(`Cline -> Claude: ${message.type} message`);
  messages.claude.push(message);
  
  res.json({ success: true });
});

// GET /claude/messages - Claude retrieves its messages
app.get('/claude/messages', (req, res) => {
  const pending = [...messages.claude];
  messages.claude = [];
  
  log(`Claude retrieved ${pending.length} messages`);
  res.json(pending);
});

// GET /cline/messages - Cline retrieves its messages
app.get('/cline/messages', (req, res) => {
  const pending = [...messages.cline];
  messages.cline = [];
  
  log(`Cline retrieved ${pending.length} messages`);
  res.json(pending);
});

//------------------------------------------
// STATUS & PING
//------------------------------------------

// GET /ping?client=claude or /ping?client=cline
app.get('/ping', (req, res) => {
  const client = req.query.client;
  
  if (!client || !['claude', 'cline'].includes(client)) {
    return res.status(400).json({ success: false, message: 'Invalid client' });
  }
  
  const count = messages[client].length;
  
  res.json({
    success: true,
    messageCount: count,
    hasUpdates: count > 0
  });
});

// GET /status - Server status
app.get('/status', (req, res) => {
  const uptime = (new Date() - START_TIME) / 1000;
  
  res.json({
    status: 'running',
    uptime: uptime,
    startTime: START_TIME.toISOString(),
    messageStats: {
      claude: messages.claude.length,
      cline: messages.cline.length
    }
  });
});

// Start server
app.listen(PORT, () => {
  log(`Simplified Claude-Cline Bridge started on port ${PORT}`);
  log(`Server PID: ${process.pid}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('Server shutting down...');
  process.exit(0);
});
