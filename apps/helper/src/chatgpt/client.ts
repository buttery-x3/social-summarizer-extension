import { createChatGPT, ChatGPTError } from '@siwc/local';
import type { ChatGPTClient, SessionState } from '@siwc/local';
import { createDpapiEncryption } from './dpapi.js';
import { prepareStorage, storageDirectory } from './storage.js';

export const inventedTranscript = `Alex: Our pretend board-game night is Friday at 6 pm.
Sam: I will bring the card game and snacks.
Jo: I can host four players, but please confirm attendance by Thursday.
Alex: Agreed. Sam brings games and snacks, Jo hosts, and everyone replies by Thursday.`;

export async function createWindowsClient(): Promise<ChatGPTClient> {
  const directory = storageDirectory();
  const encryption = createDpapiEncryption();
  if (!await encryption.isAvailable()) {
    throw new ChatGPTError('storage_encryption_unavailable', 'Windows DPAPI is unavailable. Use Windows x64 or ARM64 under your own Windows account.');
  }
  const port = Number(process.env.CHATGPT_SPIKE_PORT ?? '0');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ChatGPTError('invalid_config', 'CHATGPT_SPIKE_PORT must be an integer from 0 to 65535.');
  }
  await prepareStorage(directory);
  return createChatGPT({
    appName: 'Social Summarizer Feasibility', appId: 'social-summarizer-chatgpt-spike',
    redirectPort: port, storageDir: directory, credentialEncryption: encryption, sendHostId: true,
  });
}

export function requirePlan(session: SessionState): void {
  if (session.status !== 'connected') {
    if (session.error) {
      const error = session.error;
      throw new ChatGPTError(error.code, error.message, error.retryable, error.status, {
        requestId: error.requestId, param: error.param, responseShape: error.responseShape,
      });
    }
    throw new ChatGPTError('sign_in_required', 'Run the sign-in command to connect your ChatGPT account.');
  }
  if (!session.sharing) {
    throw new ChatGPTError('sharing_not_enabled', 'ChatGPT plan use is disabled. Run sign-in --consent and allow plan use in the browser.');
  }
}

// Reusable by a later helper. Only safe results cross this interface.
export async function summariseInventedTranscript(client: ChatGPTClient, signal: AbortSignal, requestedModel?: string) {
  requirePlan(await client.getSession());
  const models = await client.listModels({ signal });
  const model = requestedModel ? models.find(item => item.slug === requestedModel) : models[0];
  if (!model) {
    throw new ChatGPTError(requestedModel ? 'model_not_found' : 'no_models',
      requestedModel ? 'Choose a model shown by the models command.' : 'No models are available for this connection.');
  }
  // The pinned SDK sends input as an array, stream:true, store:false, and resolves
  // only after response.completed. Buffer output so partial text never looks successful.
  const result = await client.streamResponse({
    model: model.slug,
    input: [{ role: 'user', content: inventedTranscript }],
    instructions: 'Summarise this invented conversation in three short bullet points: decision, responsibilities, and deadline. Use only facts in the transcript.',
    signal,
  });
  signal.throwIfAborted();
  if (!result.text.trim()) throw new ChatGPTError('empty_response', 'The completed response had no summary text.');
  return { model: model.slug, text: result.text };
}
