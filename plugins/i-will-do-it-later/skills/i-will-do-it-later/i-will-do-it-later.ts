const pane = process.env.HERDR_PANE_ID;
if (!pane) { console.error('herdr pane 안이 아니다'); process.exit(1); }
Bun.spawnSync(['herdr', 'pane', 'send-text', pane, '/exit']);
Bun.spawnSync(['herdr', 'pane', 'send-keys', pane, 'enter']);
