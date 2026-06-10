import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '..', 'data');

export class StorageLimitError extends Error {
  constructor(collection: string, maxRecords: number) {
    super(`Storage limit of ${maxRecords} records reached for ${collection}`);
    this.name = 'StorageLimitError';
  }
}

// A storage backend for analytics records. Both the JSON (local dev) and
// MongoDB (production) implementations satisfy this contract, so the routes
// don't care which one is wired in.
export interface Repository {
  append(collection: string, record: Record<string, unknown>, maxRecords?: number): Promise<void>;
  list(collection: string): Promise<unknown[]>;
  close(): Promise<void>;
}

const filePath = (collection: string): string => path.join(DATA_DIR, `${collection}.json`);

const readFile = async (collection: string): Promise<unknown[]> => {
  try {
    const content = await fs.readFile(filePath(collection), 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
};

// File-backed repository for local development. Writes are serialized per
// collection so concurrent requests don't clobber each other's records.
export class JsonRepository implements Repository {
  private writeQueues = new Map<string, Promise<unknown>>();

  async list(collection: string): Promise<unknown[]> {
    return readFile(collection);
  }

  async append(collection: string, record: Record<string, unknown>, maxRecords = Infinity): Promise<void> {
    const previous = this.writeQueues.get(collection) ?? Promise.resolve();

    const task = previous.then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const records = await readFile(collection);

      if (records.length >= maxRecords) {
        throw new StorageLimitError(collection, maxRecords);
      }

      records.push(record);
      await fs.writeFile(filePath(collection), JSON.stringify(records, null, 2));
    });

    this.writeQueues.set(
      collection,
      task.catch(() => undefined)
    );

    await task;
  }

  async close(): Promise<void> {
    // Nothing to clean up for the file backend
  }
}
