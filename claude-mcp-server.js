// minimal-mcp-server.js
const fetch = require('node-fetch');

// Send log messages to stderr
const log = (...args) => console.error(...args);

log('Starting minimal MCP server...');

// Send message to Claude
function sendMessage(message) {
  const content = JSON.stringify(message);
  const contentLength = Buffer.byteLength(content, 'utf8');
  process.stdout.write(`Content-Length: ${contentLength}\r\n\r\n${content}`);
  log(`Sent: ${content}`);
}

// Process incoming messages
let buffer = '';
let contentLength = null;

process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  
  while (buffer.length > 0) {
    if (contentLength === null) {
      const match = buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;
      
      contentLength = parseInt(match[1], 10);
      buffer = buffer.substring(match[0].length);
    }
    
    if (buffer.length < contentLength) break;
    
    const message = buffer.substring(0, contentLength);
    buffer = buffer.substring(contentLength);
    contentLength = null;
    
    try {
      const request = JSON.parse(message);
      log(`Received: ${JSON.stringify(request)}`);
      
      if (request.method === 'initialize') {
        // Respond to initialize
        sendMessage({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            serverInfo: {
              name: 'minimal-mcp',
              version: '1.0.0'
            },
            capabilities: {}
          }
        });
        
        // Register tools
        setTimeout(() => {
          sendMessage({
            jsonrpc: '2.0',
            method: 'notifications/tools',
            params: {
              tools: [
                {
                  name: 'send_message',
                  description: 'Send a message to Cline',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      content: {
                        type: 'string',
                        description: 'Message content'
                      }
                    },
                    required: ['content']
                  }
                },
                {
                  name: 'read_messages',
                  description: 'Read messages from Cline',
                  inputSchema: {
                    type: 'object',
                    properties: {}
                  }
                }
              ]
            }
          });
        }, 100);
      } 
      else if (request.method === 'list_tools') {
        sendMessage({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: [
              {
                name: 'send_message',
                description: 'Send a message to Cline',
                inputSchema: {
                  type: 'object',
                  properties: {
                    content: {
                      type: 'string',
                      description: 'Message content'
                    }
                  },
                  required: ['content']
                }
              },
              {
                name: 'read_messages',
                description: 'Read messages from Cline',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              }
            ]
          }
        });
      }
      else if (request.method === 'call_tool') {
        const toolName = request.params.name;
        const args = request.params.arguments;
        
        if (toolName === 'send_message') {
          log(`Would send message: ${args.content}`);
          sendMessage({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{
                type: 'text',
                text: 'Message sent successfully'
              }]
            }
          });
        }
        else if (toolName === 'read_messages') {
          sendMessage({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{
                type: 'text',
                text: 'No messages available'
              }]
            }
          });
        }
      }
      else {
        sendMessage({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Method not supported: ${request.method}`
          }
        });
      }
    } catch (error) {
      log(`Error: ${error.message}`);
    }
  }
});

log('MCP server ready');