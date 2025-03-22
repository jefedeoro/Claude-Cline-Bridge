// claude-mcp-client.js
// Simplified client for Claude to connect to the bridge server

// Import dependencies
const fetch = require('node-fetch');

// Redirect console.log to stderr to avoid JSON parsing errors in Claude
const originalConsoleLog = console.log;
console.log = function() {
  return console.error.apply(console, arguments);
};

class ClaudeMCPClient {
    constructor(serverUrl = 'http://localhost:2612') {
        this.serverUrl = serverUrl;
        this.connected = false;
        this.messageHandlers = [];
        this.fileContentHandlers = new Map();
        this.commandResultHandlers = new Map();
        this.pollInterval = null;
        this.pollIntervalTime = 2000; // 2 seconds
        this.connectionId = Math.random().toString(36).substring(2, 15);
        
        // Simple connection approach
        this.connectToServer();
    }
    
    // Simple server check with helpful error message
    async connectToServer() {
        try {
            console.log(`Connecting to bridge server at ${this.serverUrl}...`);
            
            const response = await fetch(`${this.serverUrl}/status`, {
                method: 'GET',
                timeout: 3000
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log(`Connected to server with uptime ${data.uptime.toFixed(2)} seconds`);
                this.startPolling();
                this.connected = true;
            }
        } catch (error) {
            const errorMsg = `
ERROR: Cannot connect to Claude-Cline bridge server at ${this.serverUrl}

Please ensure the server is running by:
1. Open a terminal
2. Navigate to: r:/devR/mcp/Claude-Cline-Bridge
3. Run: npm start

Or manually start with: node simplified-bridge.js
            `;
            
            console.error(errorMsg);
            throw new Error(`Bridge server not available: ${error.message}`);
        }
    }

    // Get server status
    async getServerStatus() {
        try {
            const response = await fetch(`${this.serverUrl}/status`, {
                method: 'GET',
                timeout: 2000
            });
            
            if (response.ok) {
                const data = await response.json();
                return { 
                    running: true, 
                    uptime: data.uptime,
                    messageStats: data.messageStats
                };
            }
        } catch (error) {
            console.error('Error checking server status:', error.message);
        }
        
        return { running: false };
    }

    // Start polling for messages
    startPolling() {
        console.log(`Starting polling for messages at ${this.serverUrl}`);
        
        // Clear any existing interval
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        
        this.pollInterval = setInterval(async () => {
            try {
                // Check if there are any messages
                const pingResponse = await fetch(`${this.serverUrl}/ping?client=claude`);
                const pingData = await pingResponse.json();
                
                if (pingData.hasUpdates) {
                    // Fetch messages if available
                    const response = await fetch(`${this.serverUrl}/claude/messages`);
                    const messages = await response.json();
                    
                    if (messages && messages.length > 0) {
                        console.log(`Received ${messages.length} messages from Cline`);
                        messages.forEach(message => this.handleMessage(message));
                    }
                }
            } catch (error) {
                console.error('Error polling for messages:', error.message);
                
                // If server disconnects, try to reconnect
                if (this.connected) {
                    this.connected = false;
                    console.log('Lost connection to server. Will retry...');
                    setTimeout(() => this.connectToServer(), 5000);
                }
            }
        }, this.pollIntervalTime);
    }

    // Clean up resources
    cleanup() {
        this.connected = false;
        
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        
        console.log('Client disconnected from bridge server');
    }

    // Process messages from server
    handleMessage(message) {
        switch (message.type) {
            case 'fileContent':
                // Handle file content response
                const fileHandler = this.fileContentHandlers.get(message.path);
                if (fileHandler) {
                    fileHandler(message.content, message.error);
                    this.fileContentHandlers.delete(message.path);
                }
                break;

            case 'updateCodeResult':
                // Handle file update result
                console.log(`File update ${message.success ? 'succeeded' : 'failed'}: ${message.path}`);
                if (message.error) {
                    console.error(`Update error: ${message.error}`);
                }
                break;
                
            case 'fileChanged':
                // Handle notification about file changes
                console.log(`File changed externally: ${message.path}`);
                // Notify any registered file change handlers
                this.messageHandlers.forEach(handler => 
                    handler(`File changed: ${message.path}`, 'system')
                );
                break;

            case 'commandResult':
                // Handle command execution result
                const cmdHandler = this.commandResultHandlers.get(message.command);
                if (cmdHandler) {
                    cmdHandler(message.output, message.error, message.success);
                    this.commandResultHandlers.delete(message.command);
                }
                break;

            case 'message':
                // Handle message from Cline
                this.messageHandlers.forEach(handler => handler(message.content, message.from));
                break;

            case 'messages':
                // Handle batch of messages
                message.messages.forEach(msg => {
                    this.messageHandlers.forEach(handler => handler(msg.content, msg.from));
                });
                break;
        }
    }

    // Method to get a file from Cline
    async getFile(path) {
        if (!this.connected) {
            throw new Error('Not connected to bridge server');
        }

        try {
            // Request the file by sending a message to Cline
            const requestResponse = await fetch(`${this.serverUrl}/mcp/invoke`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    method: 'getFile',
                    params: { path },
                    id: Date.now()
                })
            });
            
            if (!requestResponse.ok) {
                throw new Error(`Failed to request file: ${requestResponse.statusText}`);
            }
            
            // Create a promise that will be resolved when we get the file content
            return new Promise((resolve, reject) => {
                // Set a timeout for the request
                const timeoutId = setTimeout(() => {
                    this.fileContentHandlers.delete(path);
                    reject(new Error('Timeout waiting for file content'));
                }, 30000);
                
                // Register a handler for the file content
                this.fileContentHandlers.set(path, (content, error) => {
                    clearTimeout(timeoutId);
                    if (error) {
                        reject(new Error(error));
                    } else {
                        resolve(content);
                    }
                });
            });
        } catch (error) {
            console.error(`Error getting file ${path}:`, error);
            throw error;
        }
    }

    // Method to update a file
    async updateFile(path, content) {
        if (!this.connected) {
            throw new Error('Not connected to bridge server');
        }

        try {
            // Send update request
            const response = await fetch(`${this.serverUrl}/mcp/invoke`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    method: 'updateFile',
                    params: { path, content },
                    id: Date.now()
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to update file: ${response.statusText}`);
            }
            
            // Create a promise that will be resolved when we get confirmation
            return new Promise((resolve, reject) => {
                // Set a timeout for the request
                const timeoutId = setTimeout(() => {
                    reject(new Error('Timeout waiting for file update confirmation'));
                }, 30000);
                
                // Poll for update result
                const checkInterval = setInterval(async () => {
                    try {
                        // Check for new messages
                        const pingResponse = await fetch(`${this.serverUrl}/ping?client=claude`);
                        const pingData = await pingResponse.json();
                        
                        if (pingData.hasUpdates) {
                            const msgResponse = await fetch(`${this.serverUrl}/claude/messages`);
                            const messages = await msgResponse.json();
                            
                            // Look for the update result
                            for (const message of messages) {
                                if (message.type === 'updateCodeResult' && message.path === path) {
                                    clearInterval(checkInterval);
                                    clearTimeout(timeoutId);
                                    
                                    if (!message.success) {
                                        reject(new Error(message.error || 'Failed to update file'));
                                    } else {
                                        resolve({ success: true, message: `File ${path} updated successfully` });
                                    }
                                    return;
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Error checking update result: ${error.message}`);
                    }
                }, 1000);
            });
        } catch (error) {
            console.error(`Error updating file ${path}:`, error);
            throw error;
        }
    }

    // Method to execute a command
    async executeCommand(command) {
        if (!this.connected) {
            throw new Error('Not connected to bridge server');
        }

        try {
            // Send command execution request
            const response = await fetch(`${this.serverUrl}/mcp/invoke`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    method: 'executeCommand',
                    params: { command },
                    id: Date.now()
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to execute command: ${response.statusText}`);
            }
            
            // Create a promise that will be resolved when we get the result
            return new Promise((resolve, reject) => {
                // Set a timeout for the request
                const timeoutId = setTimeout(() => {
                    this.commandResultHandlers.delete(command);
                    reject(new Error('Timeout waiting for command result'));
                }, 60000);
                
                // Register a handler for the command result
                this.commandResultHandlers.set(command, (output, error, success) => {
                    clearTimeout(timeoutId);
                    if (error) {
                        reject(new Error(error));
                    } else {
                        resolve({ output, success: success || true });
                    }
                });
            });
        } catch (error) {
            console.error(`Error executing command "${command}":`, error);
            throw error;
        }
    }

    // Method to send a message to Cline
    async sendMessage(content) {
        if (!this.connected) {
            throw new Error('Not connected to bridge server');
        }

        try {
            const response = await fetch(`${this.serverUrl}/claude/message`, {
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
            
            return await response.json();
        } catch (error) {
            console.error('Error sending message:', error);
            throw error;
        }
    }
    
    // Method to send a file to Cline
    async sendFile(name, content) {
        if (!this.connected) {
            throw new Error('Not connected to bridge server');
        }

        try {
            const response = await fetch(`${this.serverUrl}/claude/file`, {
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
            
            return await response.json();
        } catch (error) {
            console.error('Error sending file:', error);
            throw error;
        }
    }

    // Method to register a message handler
    onMessage(handler) {
        this.messageHandlers.push(handler);

        // Return a function to remove the handler
        return () => {
            this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
        };
    }
}

// Export the client
if (typeof module !== 'undefined') {
    module.exports = ClaudeMCPClient;
}

// Also make it available in the browser
if (typeof window !== 'undefined') {
    window.ClaudeMCPClient = ClaudeMCPClient;
}
