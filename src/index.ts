import express from 'express';
import rateLimit from 'express-rate-limit';
import { JsonRepository, Repository, StorageLimitError } from './storage';
import { MongoRepository } from './mongo';

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render's proxy the client IP arrives via X-Forwarded-For
app.set('trust proxy', 1);

app.use(express.json({ limit: '10kb' }));

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later' },
  })
);

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get('/hello-world', (req, res) => {
  res.json({ response: 'Hello World' });
});

const MAX_STRING_LENGTH = 500;
const MAX_RECORDS_PER_FILE = Number(process.env.MAX_RECORDS_PER_FILE) || 10_000;
const DATE_TIME_PATTERN = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} (AM|PM)$/;

interface FieldSpec {
  type: 'string' | 'number';
  enum?: readonly string[];
  pattern?: RegExp;
}

interface EntryRoute {
  path: string;
  collection: string;
  fields: Record<string, FieldSpec>;
}

const ENTRY_ROUTES: EntryRoute[] = [
  {
    path: '/click-events',
    collection: 'click-events',
    fields: {
      appID: { type: 'string' },
      sessionID: { type: 'string' },
      where: { type: 'string' },
      target: { type: 'string' },
      dateTime: { type: 'string', pattern: DATE_TIME_PATTERN },
    },
  },
  {
    path: '/page-load-events',
    collection: 'page-load-events',
    fields: {
      appID: { type: 'string' },
      sessionID: { type: 'string' },
      where: { type: 'string' },
      timeOnPage: { type: 'number' },
      dateTime: { type: 'string', pattern: DATE_TIME_PATTERN },
    },
  },
  {
    path: '/http-calls',
    collection: 'http-calls',
    fields: {
      appID: { type: 'string' },
      sessionID: { type: 'string' },
      endpoint: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
      httpStatus: { type: 'number' },
      duration: { type: 'number' },
      dateTime: { type: 'string', pattern: DATE_TIME_PATTERN },
    },
  },
  {
    path: '/sessions',
    collection: 'sessions',
    fields: {
      appID: { type: 'string' },
      sessionID: { type: 'string' },
      device: { type: 'string', enum: ['desktop', 'mobile', 'tablet'] },
      browser: { type: 'string' },
      referrer: { type: 'string' },
      startedAt: { type: 'string', pattern: DATE_TIME_PATTERN },
    },
  },
];

// Validates the payload and returns a record containing ONLY the expected
// fields — anything else the client sends is discarded, never stored
const validateAndPick = (
  body: Record<string, unknown>,
  fields: Record<string, FieldSpec>
): { errors: string[]; record: Record<string, unknown> } => {
  const errors: string[] = [];
  const record: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(fields)) {
    const value = body[name];

    if (value === undefined || value === null) {
      errors.push(`${name} is required`);
      continue;
    }

    if (spec.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${name} must be a string`);
        continue;
      }
      if (value.length > MAX_STRING_LENGTH) {
        errors.push(`${name} must be at most ${MAX_STRING_LENGTH} characters`);
        continue;
      }
      if (spec.enum && !spec.enum.includes(value)) {
        errors.push(`${name} must be one of: ${spec.enum.join(', ')}`);
        continue;
      }
      if (spec.pattern && !spec.pattern.test(value)) {
        errors.push(`${name} must match format dd/MM/yyyy hh:mm AM/PM`);
        continue;
      }
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        errors.push(`${name} must be a non-negative number`);
        continue;
      }
    }

    record[name] = value;
  }

  return { errors, record };
};

let repository: Repository;

for (const { path, collection, fields } of ENTRY_ROUTES) {
  app.post(path, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { errors, record } = validateAndPick(body, fields);

    if (errors.length > 0) {
      res.status(400).json({ message: `Validation failed: ${errors.join('; ')}`, errors });
      return;
    }

    try {
      await repository.append(collection, record, MAX_RECORDS_PER_FILE);
      res.status(201).json({ success: true, data: record });
    } catch (err) {
      if (err instanceof StorageLimitError) {
        res.status(507).json({ message: 'Storage limit reached for this event type' });
        return;
      }
      console.error(`Failed to persist record to ${collection}:`, err);
      res.status(500).json({ message: 'Failed to persist record' });
    }
  });

  app.get(path, async (req, res) => {
    try {
      res.json(await repository.list(collection));
    } catch (err) {
      console.error(`Failed to read records from ${collection}:`, err);
      res.status(500).json({ message: 'Failed to read records' });
    }
  });
}

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

const start = async (): Promise<void> => {
  repository = await createRepository();

  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
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
