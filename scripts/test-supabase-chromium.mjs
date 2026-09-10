import { app } from 'electron';
app.whenReady().then(async () => {
  await import('./test-supabase-integration.mjs');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
