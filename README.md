# Claude-Cline Bridge
NOT Functional yet!
please feel free to contribute to this project.

A simple communication bridge between Claude and Cline.

## Files

- `claude-cline-bridge.js` - Main server that handles message passing
- `cline-mcp-client.js` - Client for Cline to connect to the bridge
- `claude-mcp-client.js` - Client for Claude to connect to the bridge

## Setup

1. Install dependencies:
```
npm install
```

2. Start the server:
```
npm start
```

## Configuration

- Default port: 2612
- Both clients connect to http://localhost:2612

## Usage

### From Cline
Cline will connect using the tool interface. No additional configuration needed.

### From Claude
Claude will connect using the MCP client. No additional server startup needed.

## Troubleshooting

If clients cannot connect:
1. Ensure the server is running (`npm start`)
2. Check port 2612 is not blocked or in use
3. Look for error messages in the server console