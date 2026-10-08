import type { SuccessResponse } from '@social-summarizer/protocol';

const testButton = document.querySelector<HTMLButtonElement>('#test')!;
const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect')!;
const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#result')!;
document.querySelector<HTMLElement>('#extension-id')!.textContent = chrome.runtime.id;
const port = chrome.runtime.connect({ name: 'helper-test' });

port.onMessage.addListener((message: { state: string; detail: string; response?: SuccessResponse }) => {
  status.textContent = message.detail;
  status.dataset.state = message.state;
  testButton.disabled = message.state === 'connecting';
  disconnectButton.disabled = message.state !== 'connected' && message.state !== 'connecting';
  result.textContent = message.response ? JSON.stringify(message.response, null, 2) : 'No response yet.';
});
port.onDisconnect.addListener(() => {
  const error = chrome.runtime.lastError?.message;
  status.dataset.state = 'error';
  status.textContent = `Extension service worker disconnected${error ? `: ${error}` : '.'} Reload this page to retry.`;
  testButton.disabled = true;
  disconnectButton.disabled = true;
});
testButton.addEventListener('click', () => port.postMessage({ action: 'test' }));
disconnectButton.addEventListener('click', () => port.postMessage({ action: 'disconnect' }));
