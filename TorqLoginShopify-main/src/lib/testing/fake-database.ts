import { ObjectId, type Db } from "mongodb";

// A tiny in-memory stand-in for the few MongoDB operations the auth helpers
// use, so their logic can be tested without a database server.

type Doc = Record<string, unknown>;
type Filter = Record<string, unknown>;
type Update = Record<string, Record<string, unknown>>;

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof ObjectId) &&
    !(value instanceof Date) &&
    Object.keys(value).every((key) => key.startsWith("$"))
  );
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function toNumber(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    const value = doc[key];
    if (!isOperatorObject(condition)) return same(value, condition);
    return Object.entries(condition).every(([operator, operand]) => {
      if (value === undefined) return false;
      if (operator === "$gt") return toNumber(value) > toNumber(operand);
      if (operator === "$lt") return toNumber(value) < toNumber(operand);
      throw new Error(`Fake database does not support ${operator}.`);
    });
  });
}

function applyUpdate(doc: Doc, update: Update, inserting: boolean): void {
  for (const [operator, fields] of Object.entries(update)) {
    for (const [key, value] of Object.entries(fields)) {
      if (operator === "$set" || (operator === "$setOnInsert" && inserting)) doc[key] = value;
      else if (operator === "$inc") doc[key] = Number(doc[key] ?? 0) + Number(value);
      else if (operator === "$unset") delete doc[key];
      else if (operator !== "$setOnInsert") throw new Error(`Fake database does not support ${operator}.`);
    }
  }
}

export class FakeCollection {
  docs: Doc[] = [];

  async findOne(filter: Filter) {
    const doc = this.docs.find((candidate) => matches(candidate, filter));
    return doc ? { ...doc } : null;
  }

  private upsert(filter: Filter, update: Update): Doc {
    const created: Doc = { _id: new ObjectId() };
    for (const [key, value] of Object.entries(filter)) {
      if (!isOperatorObject(value)) created[key] = value;
    }
    applyUpdate(created, update, true);
    this.docs.push(created);
    return created;
  }

  async updateOne(filter: Filter, update: Update, options: { upsert?: boolean } = {}) {
    const doc = this.docs.find((candidate) => matches(candidate, filter));
    if (doc) {
      applyUpdate(doc, update, false);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (options.upsert) {
      this.upsert(filter, update);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }

  async findOneAndUpdate(
    filter: Filter,
    update: Update,
    options: { upsert?: boolean; returnDocument?: "before" | "after" } = {},
  ) {
    const doc = this.docs.find((candidate) => matches(candidate, filter));
    if (doc) {
      const before = { ...doc };
      applyUpdate(doc, update, false);
      return options.returnDocument === "after" ? { ...doc } : before;
    }
    if (options.upsert) {
      const created = this.upsert(filter, update);
      return options.returnDocument === "after" ? { ...created } : null;
    }
    return null;
  }

  async deleteOne(filter: Filter) {
    const index = this.docs.findIndex((candidate) => matches(candidate, filter));
    if (index === -1) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter: Filter) {
    const before = this.docs.length;
    this.docs = this.docs.filter((candidate) => !matches(candidate, filter));
    return { deletedCount: before - this.docs.length };
  }
}

export function createFakeDatabase() {
  const collections = new Map<string, FakeCollection>();
  const collection = (name: string): FakeCollection => {
    if (!collections.has(name)) collections.set(name, new FakeCollection());
    return collections.get(name)!;
  };
  return { database: { collection } as unknown as Db, collection };
}
