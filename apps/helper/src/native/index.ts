import { FrameDecoder, encodeFrame } from './framing.js';
import { HOST_NAME } from '@social-summarizer/protocol';
import { windowsBackend, type SummaryBackend } from './backend.js';
import { Dispatcher } from './dispatcher.js';

// The separate synthetic test entry supplies only a model boundary. Production
// has no mock environment switch and never spawns a diagnostic CLI.
export async function runHost(backend: SummaryBackend = windowsBackend(), timeoutMs?: number): Promise<void> {
  const decoder = new FrameDecoder();
  const diagnostic = (message: string) => process.stderr.write(`[${HOST_NAME}] ${message}\n`);
  const dispatcher = new Dispatcher({ name: HOST_NAME, pid: process.pid, nodeVersion: process.version, platform: process.platform }, backend,
    response => {
      if (response.type === 'error') diagnostic(`request failed code=${response.error.code}`);
      process.stdout.write(encodeFrame(response));
    }, timeoutMs);
  let shuttingDown: Promise<void> | undefined;
  const shutdown = () => shuttingDown ??= (async () => {
    // Give the SDK's 60s credential-rotation deadline room for storage cleanup.
    const deadline = setTimeout(() => process.exit(process.exitCode ? 1 : 0), 75_000);
    try { await dispatcher.close(); }
    finally { clearTimeout(deadline); process.stdout.end(); }
  })();
  const stop = () => { process.stdin.destroy(); void shutdown(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdout.on('error', () => { process.exitCode = 1; stop(); });
  diagnostic(`started pid=${process.pid} node=${process.version}`);
  try {
    for await (const chunk of process.stdin) {
      // Inference is not awaited: cancellation and EOF must remain readable.
      for (const request of decoder.push(Buffer.from(chunk))) dispatcher.accept(request);
    }
    decoder.finish();
    diagnostic('input closed; exiting');
  } catch {
    diagnostic('transport failure; closing input');
    process.exitCode = 1;
    process.stdin.destroy();
  } finally {
    await shutdown();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
