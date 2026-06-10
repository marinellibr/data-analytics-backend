import { app } from './app';
import { getRepository } from './repository';

const PORT = process.env.PORT || 3000;

// Local / long-running entrypoint. On Vercel the app is served as a serverless
// function (see api/index.ts) and this file is not used.
const start = async (): Promise<void> => {
  const repository = await getRepository();

  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await repository.close();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
