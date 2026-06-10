import { MongoClient, Db } from 'mongodb';
import { Repository, StorageLimitError } from './storage';

// MongoDB-backed repository for production. Each logical collection maps
// directly to a MongoDB collection in the configured database.
export class MongoRepository implements Repository {
  private constructor(
    private client: MongoClient,
    private db: Db
  ) {}

  static async connect(uri: string, dbName: string): Promise<MongoRepository> {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10_000,
    });
    await client.connect();
    return new MongoRepository(client, client.db(dbName));
  }

  async list(collection: string): Promise<unknown[]> {
    return this.db
      .collection(collection)
      .find({}, { projection: { _id: 0 } })
      .toArray();
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
