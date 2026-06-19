import express from 'express';
import rateLimit from 'express-rate-limit';
import { StorageLimitError } from './storage';
import { getRepository } from './repository';

export const app = express();

// Behind a proxy (Vercel, Render, etc.) the client IP arrives via X-Forwarded-For
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
const MAX_RECORDS_PER_COLLECTION = Number(process.env.MAX_RECORDS_PER_FILE) || 10_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface FieldSpec {
  type: 'string' | 'number' | 'object';
  enum?: readonly string[];
  pattern?: RegExp;
  fields?: Record<string, FieldSpec>;
}

interface EntryRoute {
  path: string;
  collection: string;
  fields: Record<string, FieldSpec>;
}

const ENTRY_ROUTES: EntryRoute[] = [
  {
    path: '/events',
    collection: 'events',
    fields: {
      appID: { type: 'string' },
      sessionID: { type: 'string' },
      type: { type: 'string', enum: ['click', 'pageview'] },
      location: { type: 'string' },
      element: { type: 'string' }, // optional for click events
      timeOnPage: { type: 'number' }, // optional for pageview events
      timestamp: { type: 'string', pattern: ISO_DATE_PATTERN },
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
      status: { type: 'number' },
      duration: { type: 'number' },
      timestamp: { type: 'string', pattern: ISO_DATE_PATTERN },
    },
  },
  {
    path: '/sessions',
    collection: 'sessions',
    fields: {
      appID: { type: 'string' },
      sessionID: { type: 'string' },
      userID: { type: 'string' }, // optional
      context: {
        type: 'object',
        fields: {
          device: { type: 'string', enum: ['desktop', 'mobile', 'tablet'] },
          browser: { type: 'string' },
          referrer: { type: 'string' },
        },
      },
      startTime: { type: 'string', pattern: ISO_DATE_PATTERN },
      endTime: { type: 'string', pattern: ISO_DATE_PATTERN }, // optional
    },
  },
];

// Validates the payload and returns a record containing ONLY the expected
// fields — anything else the client sends is discarded, never stored. This
// whitelist is what stops attacker-controlled keys (e.g. MongoDB operators)
// from ever reaching the database driver.
const validateAndPick = (
  body: Record<string, unknown>,
  fields: Record<string, FieldSpec>,
  prefix = ''
): { errors: string[]; record: Record<string, unknown> } => {
  const errors: string[] = [];
  const record: Record<string, unknown> = {};

  const optionalFields = ['element', 'timeOnPage', 'userID', 'endTime'];

  for (const [name, spec] of Object.entries(fields)) {
    const value = body[name];
    const fieldPath = prefix ? `${prefix}.${name}` : name;
    const isOptional = optionalFields.includes(name);

    if ((value === undefined || value === null) && !isOptional) {
      errors.push(`${fieldPath} is required`);
      continue;
    }

    if (value === undefined || value === null) {
      continue; // Skip optional fields
    }

    if (spec.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${fieldPath} must be a string`);
        continue;
      }
      if (value.length > MAX_STRING_LENGTH) {
        errors.push(`${fieldPath} must be at most ${MAX_STRING_LENGTH} characters`);
        continue;
      }
      if (spec.enum && !spec.enum.includes(value)) {
        errors.push(`${fieldPath} must be one of: ${spec.enum.join(', ')}`);
        continue;
      }
      if (spec.pattern && !spec.pattern.test(value)) {
        errors.push(`${fieldPath} must be ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)`);
        continue;
      }
      record[name] = value;
    } else if (spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        errors.push(`${fieldPath} must be a non-negative number`);
        continue;
      }
      record[name] = value;
    } else if (spec.type === 'object' && spec.fields) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${fieldPath} must be an object`);
        continue;
      }
      const { errors: nestedErrors, record: nestedRecord } = validateAndPick(
        value as Record<string, unknown>,
        spec.fields,
        fieldPath
      );
      if (nestedErrors.length > 0) {
        errors.push(...nestedErrors);
        continue;
      }
      record[name] = nestedRecord;
    }
  }

  return { errors, record };
};

for (const { path, collection, fields } of ENTRY_ROUTES) {
  app.post(path, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { errors, record } = validateAndPick(body, fields);

    if (errors.length > 0) {
      res.status(400).json({ message: `Validation failed: ${errors.join('; ')}`, errors });
      return;
    }

    try {
      const repository = await getRepository();
      await repository.append(collection, record, MAX_RECORDS_PER_COLLECTION);
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
      const repository = await getRepository();
      res.json(await repository.list(collection));
    } catch (err) {
      console.error(`Failed to read records from ${collection}:`, err);
      res.status(500).json({ message: 'Failed to read records' });
    }
  });
}

// Aggregated read: returns every event, http-call and session for a single
// app in one response, so a client doesn't have to fetch each collection and
// filter on its own.
app.get('/apps/:appID', async (req, res) => {
  const { appID } = req.params;

  if (!appID || appID.length > MAX_STRING_LENGTH) {
    res.status(400).json({ message: 'Invalid appID' });
    return;
  }

  try {
    const repository = await getRepository();
    const [events, httpCalls, sessions] = await Promise.all([
      repository.listByAppID('events', appID),
      repository.listByAppID('http-calls', appID),
      repository.listByAppID('sessions', appID),
    ]);
    res.json({ appID, events, httpCalls, sessions });
  } catch (err) {
    console.error(`Failed to read records for app ${appID}:`, err);
    res.status(500).json({ message: 'Failed to read records' });
  }
});
