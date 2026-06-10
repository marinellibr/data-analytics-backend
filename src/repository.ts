import { JsonRepository, Repository } from './storage';
import { MongoRepository } from './mongo';

// The repository is cached as a promise so that, in a serverless environment
// (e.g. Vercel), a warm invocation reuses the existing MongoDB connection
// instead of opening a new one on every request.
let repositoryPromise: Promise<Repository> | null = null;

const createRepository = async (): Promise<Repository> => {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    const dbName = process.env.MONGODB_DB || 'analytics';
    const repo = await MongoRepository.connect(uri, dbName);
    console.log(`Using MongoDB storage (database: ${dbName})`);
    return repo;
  }
  console.log('MONGODB_URI not set — using JSON file storage (development mode)');
  return new JsonRepository();
};

export const getRepository = (): Promise<Repository> => {
  if (!repositoryPromise) {
    // If the connection attempt fails, clear the cache so the next request retries
    repositoryPromise = createRepository().catch((err) => {
      repositoryPromise = null;
      throw err;
    });
  }
  return repositoryPromise;
};
