#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
class EnvSettingsMCPServer {
    server;
    settingsPath;
    encryptionKey;
    constructor() {
        this.server = new Server({
            name: 'env-settings-mcp',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        // Use Smithery profile or local storage
        const profilePath = process.env.SMITHERY_PROFILE_PATH || process.env.HOME + '/.smithery';
        this.settingsPath = path.join(profilePath, 'env-settings.json');
        this.encryptionKey = process.env.ENV_ENCRYPTION_KEY || 'default-key-change-me';
        this.setupToolHandlers();
    }
    encrypt(text) {
        const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }
    decrypt(encryptedText) {
        const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    async loadSettings() {
        try {
            const data = await fs.readFile(this.settingsPath, 'utf8');
            const encrypted = JSON.parse(data);
            const decrypted = {};
            for (const [key, value] of Object.entries(encrypted)) {
                if (typeof value === 'string') {
                    decrypted[key] = this.decrypt(value);
                }
                else {
                    decrypted[key] = value;
                }
            }
            return decrypted;
        }
        catch (error) {
            return {};
        }
    }
    async saveSettings(settings) {
        const encrypted = {};
        for (const [key, value] of Object.entries(settings)) {
            if (typeof value === 'string' && key.toLowerCase().includes('key') ||
                key.toLowerCase().includes('secret') ||
                key.toLowerCase().includes('password') ||
                key.toLowerCase().includes('token')) {
                encrypted[key] = this.encrypt(value);
            }
            else {
                encrypted[key] = value;
            }
        }
        await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
        await fs.writeFile(this.settingsPath, JSON.stringify(encrypted, null, 2));
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'set_env',
                        description: 'Set environment variable or setting (automatically encrypts sensitive values)',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                key: {
                                    type: 'string',
                                    description: 'Environment variable name',
                                },
                                value: {
                                    type: 'string',
                                    description: 'Environment variable value',
                                },
                                description: {
                                    type: 'string',
                                    description: 'Optional description for this setting',
                                },
                            },
                            required: ['key', 'value'],
                        },
                    },
                    {
                        name: 'get_env',
                        description: 'Get environment variable or setting value',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                key: {
                                    type: 'string',
                                    description: 'Environment variable name',
                                },
                            },
                            required: ['key'],
                        },
                    },
                    {
                        name: 'list_env',
                        description: 'List all environment variables and settings (values hidden for security)',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                showValues: {
                                    type: 'boolean',
                                    description: 'Show actual values (use with caution)',
                                    default: false,
                                },
                                filter: {
                                    type: 'string',
                                    description: 'Filter keys by pattern',
                                },
                            },
                        },
                    },
                    {
                        name: 'delete_env',
                        description: 'Delete environment variable or setting',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                key: {
                                    type: 'string',
                                    description: 'Environment variable name to delete',
                                },
                            },
                            required: ['key'],
                        },
                    },
                    {
                        name: 'export_env',
                        description: 'Export environment variables in various formats',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                format: {
                                    type: 'string',
                                    enum: ['dotenv', 'json', 'yaml', 'shell'],
                                    description: 'Export format',
                                    default: 'dotenv',
                                },
                                filter: {
                                    type: 'string',
                                    description: 'Filter keys by pattern',
                                },
                                maskSecrets: {
                                    type: 'boolean',
                                    description: 'Mask sensitive values in export',
                                    default: true,
                                },
                            },
                        },
                    },
                    {
                        name: 'import_env',
                        description: 'Import environment variables from text (dotenv format)',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                content: {
                                    type: 'string',
                                    description: 'Environment variables in dotenv format',
                                },
                                overwrite: {
                                    type: 'boolean',
                                    description: 'Overwrite existing values',
                                    default: false,
                                },
                            },
                            required: ['content'],
                        },
                    },
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'set_env':
                        return await this.handleSetEnv(args);
                    case 'get_env':
                        return await this.handleGetEnv(args);
                    case 'list_env':
                        return await this.handleListEnv(args);
                    case 'delete_env':
                        return await this.handleDeleteEnv(args);
                    case 'export_env':
                        return await this.handleExportEnv(args);
                    case 'import_env':
                        return await this.handleImportEnv(args);
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                throw new McpError(ErrorCode.InternalError, `Error in ${name}: ${error}`);
            }
        });
    }
    async handleSetEnv(args) {
        const settings = await this.loadSettings();
        settings[args.key] = args.value;
        if (args.description) {
            settings[`${args.key}_DESCRIPTION`] = args.description;
        }
        await this.saveSettings(settings);
        return {
            content: [
                {
                    type: 'text',
                    text: `Environment variable '${args.key}' set successfully${args.description ? ` with description` : ''}`,
                },
            ],
        };
    }
    async handleGetEnv(args) {
        const settings = await this.loadSettings();
        const value = settings[args.key];
        if (value === undefined) {
            throw new McpError(ErrorCode.InvalidRequest, `Environment variable '${args.key}' not found`);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: value,
                },
            ],
        };
    }
    async handleListEnv(args) {
        const settings = await this.loadSettings();
        let keys = Object.keys(settings);
        if (args.filter) {
            const regex = new RegExp(args.filter, 'i');
            keys = keys.filter(key => regex.test(key));
        }
        const result = keys.map(key => {
            const value = settings[key];
            const isSecret = key.toLowerCase().includes('key') ||
                key.toLowerCase().includes('secret') ||
                key.toLowerCase().includes('password') ||
                key.toLowerCase().includes('token');
            return {
                key,
                value: args.showValues ? value : (isSecret ? '***HIDDEN***' : value),
                type: isSecret ? 'secret' : 'regular',
            };
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleDeleteEnv(args) {
        const settings = await this.loadSettings();
        if (!(args.key in settings)) {
            throw new McpError(ErrorCode.InvalidRequest, `Environment variable '${args.key}' not found`);
        }
        delete settings[args.key];
        delete settings[`${args.key}_DESCRIPTION`]; // Also delete description if exists
        await this.saveSettings(settings);
        return {
            content: [
                {
                    type: 'text',
                    text: `Environment variable '${args.key}' deleted successfully`,
                },
            ],
        };
    }
    async handleExportEnv(args) {
        const settings = await this.loadSettings();
        let keys = Object.keys(settings);
        if (args.filter) {
            const regex = new RegExp(args.filter, 'i');
            keys = keys.filter(key => regex.test(key));
        }
        let output = '';
        switch (args.format) {
            case 'dotenv':
                for (const key of keys) {
                    const value = settings[key];
                    const isSecret = key.toLowerCase().includes('key') ||
                        key.toLowerCase().includes('secret') ||
                        key.toLowerCase().includes('password') ||
                        key.toLowerCase().includes('token');
                    const exportValue = (args.maskSecrets && isSecret) ? '***MASKED***' : value;
                    output += `${key}=${exportValue}\n`;
                }
                break;
            case 'json':
                const jsonObj = {};
                for (const key of keys) {
                    const value = settings[key];
                    const isSecret = key.toLowerCase().includes('key') ||
                        key.toLowerCase().includes('secret') ||
                        key.toLowerCase().includes('password') ||
                        key.toLowerCase().includes('token');
                    jsonObj[key] = (args.maskSecrets && isSecret) ? '***MASKED***' : value;
                }
                output = JSON.stringify(jsonObj, null, 2);
                break;
            case 'shell':
                for (const key of keys) {
                    const value = settings[key];
                    const isSecret = key.toLowerCase().includes('key') ||
                        key.toLowerCase().includes('secret') ||
                        key.toLowerCase().includes('password') ||
                        key.toLowerCase().includes('token');
                    const exportValue = (args.maskSecrets && isSecret) ? '***MASKED***' : value;
                    output += `export ${key}="${exportValue}"\n`;
                }
                break;
        }
        return {
            content: [
                {
                    type: 'text',
                    text: output,
                },
            ],
        };
    }
    async handleImportEnv(args) {
        const settings = await this.loadSettings();
        const lines = args.content.split('\n');
        let imported = 0;
        let skipped = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const [, key, value] = match;
                const cleanKey = key.trim();
                const cleanValue = value.trim().replace(/^["']|["']$/g, ''); // Remove quotes
                if (settings[cleanKey] && !args.overwrite) {
                    skipped++;
                }
                else {
                    settings[cleanKey] = cleanValue;
                    imported++;
                }
            }
        }
        await this.saveSettings(settings);
        return {
            content: [
                {
                    type: 'text',
                    text: `Import completed: ${imported} variables imported, ${skipped} skipped (already exist)`,
                },
            ],
        };
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Env Settings MCP server running on stdio');
    }
}
const server = new EnvSettingsMCPServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map