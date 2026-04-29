/**
 * Saved-for-later headlines.
 *
 * Each user persists their own saved articles in the RecordRoom Durable
 * Object. RBAC is `'own'` across read/update/delete — the SDK matches
 * `'own'` against `record.createdBy`, so a user only ever sees and can
 * mutate their own rows. No `ownerField` needed.
 *
 * The list survives reloads, browser changes, and signing in on a
 * different device.
 */

import type { CollectionSchema } from 'deepspace/worker'

export const savedItemsSchema: CollectionSchema = {
  name: 'savedItems',
  columns: [
    // RSS-derived stable ID — used to dedupe so toggling save on the
    // same headline doesn't create duplicate rows.
    { name: 'itemId', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'link', storage: 'text', interpretation: 'plain' },
    { name: 'source', storage: 'text', interpretation: 'plain' },
    { name: 'topic', storage: 'text', interpretation: 'plain' },
    { name: 'publishedAt', storage: 'text', interpretation: 'plain' },
    { name: 'contextLine', storage: 'text', interpretation: 'plain' },
    { name: 'shortSummary', storage: 'text', interpretation: 'plain' },
    { name: 'savedAt', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
