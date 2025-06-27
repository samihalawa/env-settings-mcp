#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

class EnvSettingsMCPServer {
  private server: Server;
  private settingsPath: string;

  constructor() {
    this.server = new Server(
      {
        name: 'env-settings-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Use Smithery profile or local storage
    const profilePath = process.env.SMITHERY_PROFILE_PATH || process.env.HOME + '/.smithery';
    this.settingsPath = path.join(profilePath, 'env-settings.json');

    this.setupToolHandlers();
  }

  private async loadSettings(): Promise<Record<string, any>> {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return {};
    }
  }

  private async saveSettings(settings: Record<string, any>): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'set_env',
            description: 'Set environment variable or setting',
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
            description: 'List all environment variables and settings',
            inputSchema: {
              type: 'object',
              properties: {
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
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Error in ${name}: ${error}`);
      }
    });
  }

  private async handleSetEnv(args: any) {
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

  private async handleGetEnv(args: any) {
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

  private async handleListEnv(args: any) {
    const settings = await this.loadSettings();
    let keys = Object.keys(settings);
    
    if (args.filter) {
      const regex = new RegExp(args.filter, 'i');
      keys = keys.filter(key => regex.test(key));
    }
    
    const result = keys.map(key => ({
      key,
      value: settings[key],
      type: 'regular',
    }));
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleDeleteEnv(args: any) {
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

  private async handleExportEnv(args: any) {
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
          output += `${key}=${value}\n`;
        }
        break;
        
      case 'json':
        const jsonObj: Record<string, any> = {};
        for (const key of keys) {
          jsonObj[key] = settings[key];
        }
        output = JSON.stringify(jsonObj, null, 2);
        break;
        
      case 'shell':
        for (const key of keys) {
          const value = settings[key];
          output += `export ${key}="${value}"\n`;
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

  private async handleImportEnv(args: any) {
    const settings = await this.loadSettings();
    const lines = args.content.split('\n');
    let imported = 0;
    let skipped = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        const cleanKey = key.trim();
        const cleanValue = value.trim().replace(/^["']|["']$/g, ''); // Remove quotes
        
        if (settings[cleanKey] && !args.overwrite) {
          skipped++;
        } else {
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
