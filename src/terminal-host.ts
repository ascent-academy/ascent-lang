import type { Host } from './host.js';

export const terminalHost: Host = {
  capabilities: {
    console: {
      write(text: string): void {
        process.stdout.write(text + '\n');
      },
    },
  },
};
