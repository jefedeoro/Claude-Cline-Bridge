// cline-mcp-client.js
// Simplified client for Cline to connect to the bridge server

// Import node-fetch with CommonJS style - compatible with v2.x
const fetch = require('node-fetch');

// Redirect console.log to stderr for cleaner JSON communication
const originalConsoleLog = console.log;
console.log = function() {
  return console.error.apply(console, arguments);
};

// Configuration
const BRIDGE_SERVER_URL = 'http://localhost:2612';
const TOOL_NAME = 'ClaudeBridge';
const POLL_INTERVAL = 2000; // 2 seconds

class ClaudeBridgeTool {
    constructor(context) {
        this.context = context;
        this.connected = false;
        this.pollInterval = null;
        this.pollIntervalTime = POLL_INTERVAL;
        this.connectionId = Math.random().toString(36).substring(2, 15);
        
        // Simple server check and connect
        this.connectToServer();
    }
    
    // Simple server check with helpful error message
    async connectToServer() {
        try {
            this.context.log(`Connecting to bridge server at ${BRIDGE_SERVER_URL}...`);
            
            const response = await fetch(`${BRIDGE_SERVER_URL}/status`, {
                method: 'GET',
                timeout: 3000
            });
            
            if (response.ok) {
                const data = await response.json();
                this.context.log(`Connected to server with uptime ${data.uptime.toFixed(2)} seconds`);
                this.startPolling();
                this.connected = true;
            }
        } catch (error) {
            const errorMsg = `
ERROR: Cannot connect to Claude-Cline bridge server at ${BRIDGE_SERVER_URL}

Please ensure the server is running by:
1. Open a terminal
2. Navigate to: r:/devR/mcp/Claude-Cline-Bridge
3. Run: npm start

Or manually start with: node simplified-bridge.js
            `;
            
            this.context.log(errorMsg);
            throw new Error(`Bridge server not available: ${error.message}`);
        }
    }

    // Start polling for messages from Claude
    startPolling() {
        this.context.log(`Starting polling for messages at ${BRIDGE_SERVER_URL}`);
        
        // Clear any existing interval
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        
        this.pollInterval = setInterval(async () => {
            try {
                // First check if there are any messages using ping
                const pingResponse = await fetch(`${BRIDGE_SERVER_URL}/ping?client=cline`);
                const pingData = await pingResponse.json();
                
                if (pingData.hasUpdates) {
                    // Fetch messages if there are updates
                    const response = await fetch(`${BRIDGE_SERVER_URL}/cline/messages`);
                    const messages = await response.json();
                    
                    if (messages && messages.length > 0) {
                        this.context.log(`Received ${messages.length} messages from Claude`);
                        
                        // Process each message
                        for (const message of messages) {
                            await this.handleMessage(message);
                        }
                    }
                }
            } catch (error) {
                this.context.log(`Error polling for messages: ${error.message}`);
                // If server disconnects, we can try to reconnect
                if (this.connected) {
                    this.connected = false;
                    this.context.log('Lost connection to server. Will retry...');
                    setTimeout(() => this.connectToServer(), 5000);
                }
            }
        }, this.pollIntervalTime);
    }

    async handleMessage(message) {
        this.context.log(`Processing message of type: ${message.type}`);
        
        try {
            switch (message.type) {
                case 'fileRequest':
                    await this.handleFileRequest(message);
                    break;

                case 'updateCode':
                    await this.handleUpdateCode(message);
                    break;

                case 'executeCommand':
                    await this.handleExecuteCommand(message);
                    break;

                case 'message':
                    // Display message from Claude in the Cline interface
                    this.context.log(`Claude: ${message.content}`);
                    break;
                    
                case 'mcp_invoke':
                    // Handle special MCP requests
                    await this.handleMcpInvoke(message);
                    break;
            }
        } catch (error) {
            this.context.log(`Error handling message: ${error.message}`);
        }
    }

    async handleFileRequest(message) {
        try {
            // Use the provided VSCode API to read the file
            const content = await this.context.readFile(message.path);

            // Send file content back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'fileContent',
                    path: message.path,
                    content
                })
            });
        } catch (error) {
            // Send error back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'fileContent',
                    path: message.path,
                    error: error.message
                })
            });
        }
    }

    async handleUpdateCode(message) {
        try {
            // Use the provided VSCode API to update the file
            await this.context.writeFile(message.path, message.content);

            // Send success response back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'updateCodeResult',
                    path: message.path,
                    success: true
                })
            });
        } catch (error) {
            // Send error back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'updateCodeResult',
                    path: message.path,
                    success: false,
                    error: error.message
                })
            });
        }
    }

    async handleExecuteCommand(message) {
        try {
            // Use the provided VSCode API to execute the command
            const output = await this.context.executeCommand(message.command);

            // Send command output back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'commandResult',
                    command: message.command,
                    output,
                    success: true
                })
            });
        } catch (error) {
            // Send error back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'commandResult',
                    command: message.command,
                    success: false,
                    error: error.message
                })
            });
        }
    }
    
    async handleMcpInvoke(message) {
        try {
            let result;
            
            // Handle different MCP methods
            switch (message.method) {
                case 'getFile':
                    const content = await this.context.readFile(message.params.path);
                    result = { content };
                    break;
                    
                case 'updateFile':
                    await this.context.writeFile(message.params.path, message.params.content);
                    result = { success: true };
                    break;
                    
                case 'executeCommand':
                    const output = await this.context.executeCommand(message.params.command);
                    result = { output, success: true };
                    break;
                    
                default:
                    throw new Error(`Unknown MCP method: ${message.method}`);
            }
            
            // Send MCP response back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/mcp/response`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: message.id,
                    result,
                    jsonrpc: "2.0"
                })
            });
        } catch (error) {
            // Send error back to Claude
            await fetch(`${BRIDGE_SERVER_URL}/mcp/response`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: message.id,
                    error: {
                        code: -32000,
                        message: error.message
                    },
                    jsonrpc: "2.0"
                })
            });
        }
    }

    // Method to send a message to Claude
    async sendMessage(content) {
        if (!this.connected) {
            throw new Error('Not connected to bridge server');
        }

        try {
            const response = await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content,
                    type: 'text'
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to send message: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result;
        } catch (error) {
            this.context.log(`Error sending message: ${error.message}`);
            throw error;
        }
    }

    // Method to notify Claude about file changes
    async notifyFileChanged(path, content) {
        if (!this.connected) {
            return;
        }

        try {
            await fetch(`${BRIDGE_SERVER_URL}/cline/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'fileChanged',
                    path,
                    content
                })
            });
        } catch (error) {
            this.context.log(`Error notifying file change: ${error.message}`);
        }
    }
    
    // Method to send a file to Claude
    async sendFile(name, content) {
        if (!this.connected) {
            throw new Error('Not connected to bridge server');
        }

        try {
            const response = await fetch(`${BRIDGE_SERVER_URL}/cline/file`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    content
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to send file: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result;
        } catch (error) {
            this.context.log(`Error sending file: ${error.message}`);
            throw error;
        }
    }
    
    // Clean up resources when disconnecting
    cleanup() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.connected = false;
        this.context.log('Client disconnected from bridge server');
    }
}

// Export the tool definition for Cline
module.exports = {
    name: TOOL_NAME,
    description: 'A tool that connects Cline to Claude for real-time collaboration',
    version: '1.0.0',

    // Methods exposed to Cline
    methods: {
        sendMessage: {
            description: 'Send a message to Claude',
            parameters: {
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
        sendFile: {
            description: 'Send a file to Claude',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'File name'
                    },
                    content: {
                        type: 'string',
                        description: 'File content'
                    }
                },
                required: ['name', 'content']
            }
        },
        notifyFileChanged: {
            description: 'Notify Claude about file changes',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path'
                    },
                    content: {
                        type: 'string',
                        description: 'New file content'
                    }
                },
                required: ['path', 'content']
            }
        }
    },

    // Create an instance of the tool
    createInstance: (context) => new ClaudeBridgeTool(context)
};
