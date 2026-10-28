#!/usr/bin/env node
// Marketing Studio: an MCP server that Claude Desktop runs on this laptop (a desktop extension). Claude does the
// creative work; this server is its camera and export button: it captures app and website screens (also behind a
// login), reports on supplied audio, and exports Claude's own designs as images and videos.
// stdout carries the MCP protocol, so anything else must go to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeBrowser } from './engine/browser.mjs';
import { INSTRUCTIONS } from './instructions.mjs';
import { VERSION } from './paths.mjs';
import { registerBrand } from './tools/brand.mjs';
import { registerCapture } from './tools/capture.mjs';
import { registerExport } from './tools/export.mjs';
import { registerFindPage } from './tools/find_page.mjs';
import { registerInbox } from './tools/inbox.mjs';
import { registerProjects } from './tools/projects.mjs';
import { registerReadPage } from './tools/read_page.mjs';
import { registerRecord } from './tools/record.mjs';
import { registerSignIn } from './tools/sign_in.mjs';
import { registerStatus } from './tools/status.mjs';
import { registerViewer, showsViewer } from './tools/viewer.mjs';
import { registerWait } from './tools/wait.mjs';

const server = new McpServer({ name: 'marketing-studio', title: 'Marketing Studio', version: VERSION }, { instructions: INSTRUCTIONS });
registerStatus(server);
registerFindPage(server);
registerReadPage(server);
registerCapture(server);
registerRecord(server);
registerWait(server);
registerSignIn(server);
registerBrand(server);
registerInbox(server);
registerExport(server);
registerViewer(server);
registerProjects(server);

process.on('uncaughtException', (e) => console.error('[marketing-studio]', e));
const stop = async () => {
  await closeBrowser();
  process.exit(0);
};
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
await server.connect(new StdioServerTransport());
console.error(`[marketing-studio] ${VERSION} ready`);
server.server.oninitialized = () => console.error(`[marketing-studio] chat app: ${JSON.stringify(server.server.getClientVersion())}, shows the viewer: ${showsViewer(server)}`);
