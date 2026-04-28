/**
 * Admin Feature - Schema
 * 
 * Admin-only settings collection demonstrating:
 * - Collection-level access restriction
 * - Key-value settings storage
 */

import type { CollectionSchema } from '@spaces/sdk/worker'

export const settingsSchema: CollectionSchema = {
  name: 'settings',
  fields: {
    key: { type: 'string', required: true },
    value: { type: 'string', required: true },
  },
  permissions: {
    // Only admins can access this collection
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
