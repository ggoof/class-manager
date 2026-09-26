/**
 * Firestore connection plus the small amount of machinery a document store needs
 * that a relational database used to give us for free: generated ids, unique
 * keys, chunked batch writes and Timestamp <-> Date conversion.
 *
 * Nothing here knows about the domain — see `db.ts` for the collections.
 */
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Query,
  type WriteBatch,
} from 'firebase-admin/firestore';
import { env } from './env.js';

function buildApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  // Against the emulator there is nothing to authenticate to, and asking for
  // application-default credentials would throw on a machine that has none.
  if (env.firestoreEmulatorHost) {
    return initializeApp({ projectId: env.firebaseProjectId });
  }
  return initializeApp({
    credential: env.firebaseServiceAccount
      ? cert(JSON.parse(env.firebaseServiceAccount))
      : applicationDefault(),
    projectId: env.firebaseProjectId,
  });
}

export const firestore = getFirestore(buildApp());

// `undefined` has to mean "leave this field alone" so that partial updates work
// the way the routes expect; without this Firestore rejects the write instead.
firestore.settings({ ignoreUndefinedProperties: true });

/** A Firestore-generated document id, obtained without writing anything. */
export function newId(collection: string): string {
  return firestore.collection(collection).doc().id;
}

// ------------------------------------------------------------------ read side

export function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value as string);
}

export function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

/** Firestore has no `IN` over more than 30 values, and `getAll` dislikes huge fan-outs. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchDocs<T>(
  refs: DocumentReference[],
  map: (id: string, data: DocumentData) => T,
): Promise<T[]> {
  if (refs.length === 0) return [];
  const out: T[] = [];
  for (const group of chunk(refs, 300)) {
    const snaps = await firestore.getAll(...group);
    for (const snap of snaps) {
      if (snap.exists) out.push(map(snap.id, snap.data() as DocumentData));
    }
  }
  return out;
}

export async function runQuery<T>(
  query: Query,
  map: (id: string, data: DocumentData) => T,
): Promise<T[]> {
  const snap = await query.get();
  return snap.docs.map((d) => map(d.id, d.data()));
}

/** `where(field, 'in', values)` with the 30-value limit handled. */
export async function queryIn<T>(
  collection: CollectionReference,
  field: string,
  values: string[],
  map: (id: string, data: DocumentData) => T,
): Promise<T[]> {
  if (values.length === 0) return [];
  const out: T[] = [];
  for (const group of chunk([...new Set(values)], 30)) {
    out.push(...(await runQuery(collection.where(field, 'in', group), map)));
  }
  return out;
}

export async function countQuery(query: Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

// ----------------------------------------------------------------- write side

/**
 * A write batch that spills into further batches past Firestore's 500-operation
 * limit. Not atomic across chunks — every caller here is idempotent, so a partial
 * commit can simply be re-run.
 */
export class Batcher {
  private readonly queued: ((batch: WriteBatch) => void)[] = [];

  set(ref: DocumentReference, data: DocumentData, options?: { merge: boolean }) {
    this.queued.push((b) => (options ? b.set(ref, data, options) : b.set(ref, data)));
    return this;
  }

  update(ref: DocumentReference, data: DocumentData) {
    this.queued.push((b) => b.update(ref, data));
    return this;
  }

  delete(ref: DocumentReference) {
    this.queued.push((b) => b.delete(ref));
    return this;
  }

  get size() {
    return this.queued.length;
  }

  async commit(): Promise<number> {
    for (const group of chunk(this.queued, 450)) {
      const batch = firestore.batch();
      for (const apply of group) apply(batch);
      await batch.commit();
    }
    return this.queued.length;
  }
}

/** Deletes every document a query matches, in pages, and reports how many went. */
export async function deleteQuery(query: Query): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(400).get();
    if (snap.empty) return removed;
    const batch = firestore.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += snap.size;
    if (snap.size < 400) return removed;
  }
}

// --------------------------------------------------------------- unique keys

/**
 * Firestore has no unique constraint, so single-field uniqueness (a username, an
 * email, a class code) is held in a reservation collection whose document id IS
 * the value. Claiming happens in a transaction, which is what makes two
 * simultaneous sign-ups with the same username impossible rather than unlikely.
 *
 * Composite uniqueness — one enrollment per student per class, one attendance
 * row per student per session — needs none of this: those documents use a
 * deterministic id built from their key, so the collection enforces it directly.
 */
export interface UniqueKey {
  scope: 'username' | 'email' | 'courseCode';
  value: string;
}

const UNIQUE_COLLECTION = 'uniqueKeys';

const messages: Record<UniqueKey['scope'], string> = {
  username: 'That username is already taken',
  email: 'That email is already registered',
  courseCode: 'That class code already exists',
};

function keyRef(key: UniqueKey): DocumentReference {
  // Doc ids may not contain "/", and are case-sensitive; usernames, emails and
  // class codes are all matched case-insensitively elsewhere, so fold here too.
  const id = `${key.scope}__${encodeURIComponent(key.value.toLowerCase())}`;
  return firestore.collection(UNIQUE_COLLECTION).doc(id);
}

export class UniqueViolation extends Error {
  readonly statusCode = 409;
  constructor(readonly scope: UniqueKey['scope']) {
    super(messages[scope]);
  }
}

/**
 * Reserves every key for `ownerId`, or throws `UniqueViolation` naming the first
 * one somebody else already holds. Re-claiming a key you already own is a no-op,
 * so this is safe to call on an update that did not actually change the value.
 */
export async function claimUnique(keys: UniqueKey[], ownerId: string): Promise<void> {
  if (keys.length === 0) return;
  await firestore.runTransaction(async (tx) => {
    const refs = keys.map(keyRef);
    const snaps = await tx.getAll(...refs);
    snaps.forEach((snap, i) => {
      if (snap.exists && snap.get('ownerId') !== ownerId) throw new UniqueViolation(keys[i].scope);
    });
    refs.forEach((ref, i) => tx.set(ref, { ownerId, value: keys[i].value }));
  });
}

export async function releaseUnique(keys: UniqueKey[]): Promise<void> {
  if (keys.length === 0) return;
  const batch = new Batcher();
  for (const key of keys) batch.delete(keyRef(key));
  await batch.commit();
}

/** Claims the new keys, then drops any old ones the caller has moved off. */
export async function reclaimUnique(
  next: UniqueKey[],
  previous: UniqueKey[],
  ownerId: string,
): Promise<void> {
  await claimUnique(next, ownerId);
  const kept = new Set(next.map((k) => `${k.scope}__${k.value.toLowerCase()}`));
  await releaseUnique(previous.filter((k) => !kept.has(`${k.scope}__${k.value.toLowerCase()}`)));
}
