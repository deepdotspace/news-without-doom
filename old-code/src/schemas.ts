/**
 * Collection Schemas
 */

import type { CollectionSchema } from '@spaces/sdk/worker'
import { USERS_COLLECTION_FIELDS } from '@spaces/sdk/worker'
import { settingsSchema } from './schemas/admin-schema'

const usersSchema: CollectionSchema = {
  name: 'users',
  fields: {
    ...USERS_COLLECTION_FIELDS,
  },
  permissions: {
    viewer: {
      read: 'own',
      create: false,
      update: 'own',
      delete: false,
      writableFields: [],
    },
    member: {
      read: true,
      create: false,
      update: 'own',
      delete: false,
      writableFields: [],
    },
    admin: { read: true, create: false, update: true, delete: true },
  },
}

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
]
