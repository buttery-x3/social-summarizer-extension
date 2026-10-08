import { ChatGPTError, CHATGPT_USAGE_URL } from '@siwc/local';
import { createWindowsClient, requirePlan, summariseInventedTranscript } from './chatgpt/client.js';

const help = `Windows ChatGPT feasibility CLI (personal noncommercial experiment)
  sign-in [--new] [--consent]   Continue with ChatGPT in your default browser
  status                       Show safe connection state
  profiles                     List saved registrations without credentials
  select PROFILE_ID            Select a saved registration
  models                       Discover models using your ChatGPT plan
  summary [--model SLUG]        Summarise the built-in invented transcript
  disconnect                   Revoke session and clear selected local tokens
  clear-local-credentials       Alias for disconnect; registration is retained
  help                         Show these commands
Options: --timeout-ms N (1..600000; default 300000)
Manage usage: ${CHATGPT_USAGE_URL}`;

function parseArgs(args: string[]) {
  const command = args[0] ?? 'help';
  const values = args.slice(1);
  let timeoutMs = 300_000;
  let model: string | undefined;
  let newProfile = false;
  let reconsent = false;
  let profileId: string | undefined;
  for (let i = 0; i < values.length; i++) {
    const option = values[i];
    if (option === '--timeout-ms') timeoutMs = Number(values[++i]);
    else if (option === '--model' && command === 'summary') {
      model = values[++i];
      if (!model || model.startsWith('--')) throw new ChatGPTError('invalid_args', 'Provide a model slug after --model.');
    }
    else if (option === '--new' && command === 'sign-in') newProfile = true;
    else if (option === '--consent' && command === 'sign-in') reconsent = true;
    else if (command === 'select' && !profileId && option && !option.startsWith('--')) profileId = option;
    else throw new ChatGPTError('invalid_args', 'Unknown argument. Run help for supported commands.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new ChatGPTError('invalid_args', '--timeout-ms must be an integer from 1 to 600000.');
  }
  if (!['sign-in', 'status', 'profiles', 'select', 'models', 'summary', 'disconnect', 'clear-local-credentials', 'help'].includes(command)) {
    throw new ChatGPTError('invalid_args', 'Unknown command. Run help for supported commands.');
  }
  if (command === 'select' && !profileId) throw new ChatGPTError('invalid_args', 'Provide a profile ID from profiles.');
  return { command, timeoutMs, model, newProfile, reconsent, profileId };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') { console.log(help); return; }
  const controller = new AbortController();
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = AbortSignal.any([controller.signal, timeout]);
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const client = await createWindowsClient();
    signal.throwIfAborted();
    if (options.command === 'sign-in') {
      console.log('Continue with ChatGPT in your browser. Choose an account/workspace and explicitly allow ChatGPT plan use. Ctrl+C cancels.');
      const session = await client.signIn({ signal, newProfile: options.newProfile, reconsent: options.reconsent });
      console.log(JSON.stringify(session, null, 2));
      if (!session.sharing) {
        throw new ChatGPTError('sharing_not_enabled', 'Identity sign-in completed, but ChatGPT plan use is disabled. Run sign-in --consent to enable it.');
      }
      console.log('Sign-in and plan permission confirmed. Run summary to test completed inference.');
    } else if (options.command === 'status') {
      const session = await client.getSession();
      console.log(JSON.stringify(session, null, 2));
      if (session.error) process.exitCode = 1;
    } else if (options.command === 'profiles') {
      console.log(JSON.stringify(await client.listProfiles(), null, 2));
    } else if (options.command === 'select') {
      console.log(JSON.stringify(await client.selectProfile(options.profileId!), null, 2));
    } else if (options.command === 'models') {
      console.log(JSON.stringify(await client.listModels({ signal }), null, 2));
    } else if (options.command === 'summary') {
      requirePlan(await client.getSession());
      console.log(`Using ChatGPT plan. Manage usage: ${CHATGPT_USAGE_URL}`);
      const result = await summariseInventedTranscript(client, signal, options.model);
      console.log(`Completed summary (${result.model}):\n${result.text}`);
    } else {
      await client.disconnect();
      console.log('Selected local tokens cleared; registration retained for later sign-in.');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new ChatGPTError('cancelled', 'Operation cancelled; no successful summary was reported.');
    if (timeout.aborted) throw new ChatGPTError('timed_out', 'Operation timed out; retry when ready. No successful summary was reported.');
    throw error;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

main().catch(error => {
  if (error instanceof ChatGPTError) {
    // The SDK sanitizes error messages, identifiers and response shapes. Never
    // print raw upstream errors, authorization URLs, token sets or stack traces.
    console.error(JSON.stringify(error.toJSON()));
    if (error.code.includes('usage_limit')) console.error(`Manage usage: ${CHATGPT_USAGE_URL}`);
  } else {
    console.error('The operation failed. Check the Windows runtime and retry. No credentials were printed.');
  }
  process.exitCode = 1;
});
