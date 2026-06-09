import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '..', 'data');

// Serializes writes per file so concurrent requests don't lose records
const writeQueues = new Map<string, Promise<unknown>>();

const filePath = (fileName: string): string => path.join(DATA_DIR, fileName);

export class StorageLimitError extends Error {
  constructor(fileName: string, maxRecords: number) {
    super(`Storage limit of ${maxRecords} records reached for ${fileName}`);
    this.name = 'StorageLimitError';
  }
}

export const readRecords = async (fileName: string): Promise<unknown[]> => {
  try {
    const content = await fs.readFile(filePath(fileName), 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
};

export const appendRecord = async <T>(fileName: string, record: T, maxRecords = Infinity): Promise<T> => {
  const previous = writeQueues.get(fileName) ?? Promise.resolve();

  const task = previous.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const records = await readRecords(fileName);

    if (records.length >= maxRecords) {
      throw new StorageLimitError(fileName, maxRecords);
    }

    records.push(record);
    await fs.writeFile(filePath(fileName), JSON.stringify(records, null, 2));
    return record;
  });

  writeQueues.set(
    fileName,
    task.catch(() => undefined)
  );

  return task;
};
