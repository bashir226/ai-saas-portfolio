import { createApplication } from './app.js';

const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? '127.0.0.1';
const application = createApplication();
const server = application.listen(port, host, () => {
  console.log(`FlowForge API listening at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    application.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
