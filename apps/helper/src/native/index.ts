import { once } from 'node:events';
import { FrameDecoder, encodeFrame } from './framing.ts';
import { handleRequest, HOST_NAME } from '../shared/protocol.ts';

const host = { name: HOST_NAME, pid: process.pid, nodeVersion: process.version, platform: process.platform };
const decoder = new FrameDecoder();
const diagnostic = (message: string) => process.stderr.write(`[${HOST_NAME}] ${message}\n`);

// No network, shell commands, timers or background work. EOF ends this process.
async function main(): Promise<void> {
  diagnostic(`started pid=${host.pid} node=${host.nodeVersion}`);
  try {
    for await (const chunk of process.stdin) {
      for (const request of decoder.push(Buffer.from(chunk))) {
        const response = handleRequest(request, host);
        if (response.type === 'error') diagnostic(response.error.message);
        if (!process.stdout.write(encodeFrame(response))) await once(process.stdout, 'drain');
      }
    }
    decoder.finish();
    diagnostic('input closed; exiting');
    process.stdout.end();
  } catch (error) {
    diagnostic(`transport failure: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    process.stdin.destroy();
    process.stdout.end();
  }
}

process.stdout.on('error', (error) => {
  diagnostic(`output closed: ${error.message}`);
  process.exit(1);
});
void main();
