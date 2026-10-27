#!/usr/bin/env node
// Marketing Studio: an MCP server that Claude Desktop runs on this laptop (a desktop extension). Claude does the
// creative work; this server is its camera and export button: it captures app and website screens (also behind a
// login), reports on supplied audio, and exports Claude's own designs as images and videos.
// stdout carries the MCP protocol, so anything else must go to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { INSTRUCTIONS } from './instructions.mjs';
import { VERSION } from './paths.mjs';
import { registerStatus } from './tools/status.mjs';

const server = new McpServer({ name: 'marketing-studio', title: 'Marketing Studio', version: VERSION }, { instructions: INSTRUCTIONS });
registerStatus(server);

process.on('uncaughtException', (e) => console.error('[marketing-studio]', e));
await server.connect(new StdioServerTransport());
console.error(`[marketing-studio] ${VERSION} ready`);
