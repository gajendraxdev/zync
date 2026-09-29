document.getElementById('ping').addEventListener('click', () => {
  window.zync.pane.postMessage({ type: 'ping' });
});

window.zync.pane.onMessage(message => {
  if (message?.type === 'pong') document.getElementById('reply').textContent = message.text;
});
