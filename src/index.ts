import express from 'express';
import { appendRecord, readRecords } from './storage';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

interface EntryRoute {
  path: string;
  fileName: string;
  requiredFields: string[];
}

const ENTRY_ROUTES: EntryRoute[] = [
  {
    path: '/click-events',
    fileName: 'click-events.json',
    requiredFields: ['appID', 'sessionID', 'where', 'target', 'dateTime'],
  },
  {
    path: '/page-load-events',
    fileName: 'page-load-events.json',
    requiredFields: ['appID', 'sessionID', 'where', 'timeOnPage', 'dateTime'],
  },
  {
    path: '/http-calls',
    fileName: 'http-calls.json',
    requiredFields: ['appID', 'sessionID', 'endpoint', 'method', 'httpStatus', 'duration', 'dateTime'],
  },
  {
    path: '/sessions',
    fileName: 'sessions.json',
    requiredFields: ['sessionID', 'appID', 'device', 'browser', 'referrer', 'startedAt'],
  },
];

for (const { path, fileName, requiredFields } of ENTRY_ROUTES) {
  app.post(path, async (req, res) => {
    const body = req.body ?? {};
    const missing = requiredFields.filter((field) => body[field] === undefined || body[field] === null);

    if (missing.length > 0) {
      res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    try {
      const record = await appendRecord(fileName, body);
      res.status(201).json({ success: true, data: record });
    } catch (err) {
      console.error(`Failed to persist record to ${fileName}:`, err);
      res.status(500).json({ message: 'Failed to persist record' });
    }
  });

  app.get(path, async (req, res) => {
    try {
      res.json(await readRecords(fileName));
    } catch (err) {
      console.error(`Failed to read records from ${fileName}:`, err);
      res.status(500).json({ message: 'Failed to read records' });
    }
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
