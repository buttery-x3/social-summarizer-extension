import type { PageStatus } from './service-worker.js';

const testButton = document.querySelector<HTMLButtonElement>('#test')!;
const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect')!;
const summaryButton = document.querySelector<HTMLButtonElement>('#summary')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!;
const checkButton = document.querySelector<HTMLButtonElement>('#check')!;
const transcript = document.querySelector<HTMLTextAreaElement>('#transcript')!;
const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#result')!;
const summary = document.querySelector<HTMLElement>('#summary-result')!;
transcript.value = `Alex: Our invented board-game night is Friday at 6 pm.
Sam: I will bring the card game and snacks.
Jo: I can host four players. Please confirm attendance by Thursday.
Alex: Agreed. Sam brings games and snacks, Jo hosts, and everyone replies by Thursday.`;
document.querySelector<HTMLElement>('#extension-id')!.textContent = chrome.runtime.id;
const port = chrome.runtime.connect({ name: 'helper-test' });
port.onMessage.addListener((message: PageStatus) => {
  status.textContent = message.detail;
  status.dataset.state = message.state;
  document.querySelector<HTMLElement>('#helper-status')!.textContent = message.helperConnected ? 'Helper connected' : 'Helper disconnected';
  document.querySelector<HTMLElement>('#chatgpt-status')!.textContent = !message.connection ? 'ChatGPT connection not checked' :
    !message.connection.connected ? 'ChatGPT signed out' : !message.connection.planEnabled ? 'ChatGPT connected; plan permission disabled' : 'ChatGPT connected with plan permission';
  testButton.disabled = checkButton.disabled = summaryButton.disabled = transcript.disabled = message.busy;
  cancelButton.disabled = !message.busy || message.state === 'cancelling';
  disconnectButton.disabled = !message.helperConnected;
  result.textContent = message.response ? JSON.stringify(message.response, null, 2) : 'No diagnostic response yet.';
  summary.textContent = message.summary ? message.summary.text : 'No completed summary yet.';
  document.querySelector<HTMLElement>('#model')!.textContent = message.summary?.model ?? '—';
});
port.onDisconnect.addListener(() => {
  void chrome.runtime.lastError;
  status.dataset.state = 'error';
  status.textContent = 'Extension service worker disconnected. Reload this page to retry.';
  testButton.disabled = checkButton.disabled = summaryButton.disabled = cancelButton.disabled = disconnectButton.disabled = true;
  summary.textContent = 'No completed summary yet.';
});
testButton.addEventListener('click', () => port.postMessage({ action: 'test' }));
checkButton.addEventListener('click', () => port.postMessage({ action: 'status' }));
summaryButton.addEventListener('click', () => port.postMessage({ action: 'summary', transcript: transcript.value }));
cancelButton.addEventListener('click', () => port.postMessage({ action: 'cancel' }));
disconnectButton.addEventListener('click', () => port.postMessage({ action: 'disconnect' }));
