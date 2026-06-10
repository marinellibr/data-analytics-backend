// Vercel serverless entrypoint. The whole Express app is served as a single
// function; vercel.json routes every request here. The MongoDB connection is
// cached across warm invocations (see src/repository.ts).
import { app } from '../src/app';

export default app;
