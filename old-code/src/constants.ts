/**
 * App Constants
 */

import type { BadgeProps } from './components/ui'

type BadgeVariant = NonNullable<BadgeProps['variant']>

// ============================================================================
// User Roles
// ============================================================================

export const ROLES = {
  VIEWER: 'viewer',
  MEMBER: 'member',
  ADMIN: 'admin',
} as const

export type Role = typeof ROLES[keyof typeof ROLES]

export const ROLE_CONFIG: Record<Role, { title: string; badgeVariant: BadgeVariant; description: string }> = {
  [ROLES.VIEWER]: {
    title: 'Viewer',
    badgeVariant: 'secondary',
    description: 'Read-only access',
  },
  [ROLES.MEMBER]: {
    title: 'Member',
    badgeVariant: 'default',
    description: 'Can create and edit own content',
  },
  [ROLES.ADMIN]: {
    title: 'Admin',
    badgeVariant: 'warning',
    description: 'Full access to all features',
  },
}
