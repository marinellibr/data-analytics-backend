import { MongoClient, Db } from 'mongodb';
import { Repository, StorageLimitError } from './storage';

// Collections that are scoped per application and benefit from an appID index.
const APP_COLLECTIONS = ['events', 'http-calls', 'sessions'];

// Caps so a single read can never turn into an unbounded scan/return:
// queries are killed server-side after QUERY_MAX_TIME_MS, and at most
// MAX_RESULTS documents come back (storage already caps a collection at 10k).
const QUERY_MAX_TIME_MS = 5_000;
const MAX_RESULTS = 10_000;

// MongoDB-backed repository for production. Each logical collection maps
// directly to a MongoDB collection in the configured database.
export class MongoRepository implements Repository {
  private constructor(
    private client: MongoClient,
    private db: Db
  ) {}

  static async connect(uri: string, dbName: string): Promise<MongoRepository> {
    // Tuned for serverless: a small pool per instance keeps a burst of cold
    // starts from exhausting the cluster's connection limit, and short
    // timeouts stop a single request from hanging the function for 10s when
    // the database is under pressure.
    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
      socketTimeoutMS: 10_000,
    });
    await client.connect();
    const repo = new MongoRepository(client, client.db(dbName));
    await repo.ensureIndexes();
    return repo;
  }

  // Index appID (+ timestamp) so per-app reads are an index seek instead of a
  // full collection scan — the difference between a cheap query and a 30k-doc
  // scan an attacker could trigger with a tiny request. createIndex is
  // idempotent; a failure here must not take the API down.
  private async ensureIndexes(): Promise<void> {
    try {
      await Promise.all(
        APP_COLLECTIONS.map((c) =>
          this.db.collection(c).createIndex({ appID: 1, timestamp: -1 })
        )
      );
    } catch (err) {
      console.error('Failed to ensure indexes (continuing without them):', err);
    }
  }

  async list(collection: string): Promise<unknown[]> {
    return this.db
      .collection(collection)
      .find({}, { projection: { _id: 0 } })
      .limit(MAX_RESULTS)
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .toArray();
  }

  async listByAppID(collection: string, appID: string): Promise<unknown[]> {
    // appID arrives as a plain string from the route param, so the filter
    // value can't smuggle in query operators.
    return this.db
      .collection(collection)
      .find({ appID }, { projection: { _id: 0 } })
      .limit(MAX_RESULTS)
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .toArray();
  }

  async distinctAppIDs(collections: string[]): Promise<string[]> {
    const arrays = await Promise.all(
      collections.map((c) =>
        this.db.collection(c).distinct('appID', {}, { maxTimeMS: QUERY_MAX_TIME_MS })
      )
    );
    const ids = new Set<string>();
    for (const arr of arrays) {
      for (const id of arr) {
        if (typeof id === 'string') ids.add(id);
      }
    }
    return [...ids].sort();
  }

  async append(collection: string, record: Record<string, unknown>, maxRecords = Infinity): Promise<void> {
    if (maxRecords !== Infinity) {
      const count = await this.db.collection(collection).estimatedDocumentCount();
      if (count >= maxRecords) {
        throw new StorageLimitError(collection, maxRecords);
      }
    }

    // record is built from a field whitelist in the route layer, so no
    // attacker-controlled keys (e.g. operators) reach the driver here.
    await this.db.collection(collection).insertOne({ ...record });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
