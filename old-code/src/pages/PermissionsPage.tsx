/**
 * Permissions Page
 *
 * Displays the auto-generated RBAC permission matrix from schemas.
 * Accessible to all authenticated users.
 */

import { useState, useMemo } from 'react'
import { useUser, useTeams, type Team } from '@spaces/sdk/storage'
import { analyzePermissions, type ResolvedPermission, type CollectionPermissionSummary, type FieldSchema } from '@spaces/sdk/worker'
import { Badge, type BadgeProps } from '../components/ui'
import { ROLES, ROLE_CONFIG, type Role } from '../constants'
import { schemas } from '../schemas'

type BadgeVariant = NonNullable<BadgeProps['variant']>

const LEVEL_DISPLAY: Record<string, { label: string; variant: BadgeVariant }> = {
  'true': { label: 'all', variant: 'success' },
  'false': { label: 'none', variant: 'destructive' },
  'own': { label: 'own', variant: 'default' },
  'unclaimed-or-own': { label: 'unclaimed/own', variant: 'info' },
  'collaborator': { label: 'collaborator', variant: 'warning' },
  'team': { label: 'team', variant: 'warning' },
  'access': { label: 'access', variant: 'warning' },
}

export default function PermissionsPage() {
  const { user } = useUser()
  const { teams } = useTeams()
  const currentRole = user?.role ?? ROLES.VIEWER
  const roleConfig = ROLE_CONFIG[currentRole as Role] ?? ROLE_CONFIG[ROLES.VIEWER]

  const analysis = useMemo(() => analyzePermissions(schemas), [])

  const roleOrder = Object.keys(ROLE_CONFIG)
  const sortedRoles = useMemo(() => {
    const known = analysis.roles.filter(r => roleOrder.includes(r))
    const unknown = analysis.roles.filter(r => !roleOrder.includes(r)).sort()
    known.sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b))
    return [...known, ...unknown]
  }, [analysis.roles])

  const userTeams = useMemo(() => {
    if (!user?.id) return []
    return teams.filter(t =>
      t.createdBy === user.id || t.members?.some(m => m.userId === user.id)
    )
  }, [teams, user?.id])

  return (
    <div className="h-full bg-background overflow-y-auto">
      <div className="bg-card/60 backdrop-blur-md border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'sans-serif' }}>Permissions</h1>
              <p className="text-muted-foreground mt-1" style={{ fontFamily: 'sans-serif' }}>RBAC permission matrix for all collections</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground" style={{ fontFamily: 'sans-serif' }}>Your role:</span>
              <Badge variant={roleConfig.badgeVariant}>{roleConfig.title}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <PermissionLegend />
        {analysis.collections.map(collection => (
          <CollectionCard
            key={collection.collection}
            collection={collection}
            roles={sortedRoles}
            currentRole={currentRole}
            userTeams={userTeams}
          />
        ))}
        {analysis.collections.length === 0 && (
          <p className="text-center text-muted-foreground py-8" style={{ fontFamily: 'sans-serif' }}>No collections defined in schemas</p>
        )}
      </div>
    </div>
  )
}

function PermissionLegend() {
  return (
    <div className="bg-muted/40 rounded-xl border border-border p-4" style={{ fontFamily: 'sans-serif' }}>
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Permission Levels</h3>
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(LEVEL_DISPLAY).slice(0, 6).map(([key, { label, variant }]) => (
          <div key={key} className="flex items-center gap-1.5">
            <Badge variant={variant}>{label}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

function CollectionCard({ collection, roles, currentRole, userTeams }: {
  collection: CollectionPermissionSummary
  roles: string[]
  currentRole: string
  userTeams: Team[]
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-muted/40 rounded-xl border border-border overflow-hidden" style={{ fontFamily: 'sans-serif' }}>
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <code className="text-sm font-semibold text-primary bg-muted px-2 py-1 rounded">
          {collection.collection}
        </code>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? 'Hide fields' : 'Show fields'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Read</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Create</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Update</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Delete</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(role => {
              const perms = collection.permissions[role]
              if (!perms) return null
              const rc = ROLE_CONFIG[role as Role]
              const isCurrentRole = role === currentRole
              return (
                <tr key={role} className={`border-b border-border/20 last:border-0 ${isCurrentRole ? 'bg-primary/10' : ''}`}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-foreground">{role}</span>
                    {isCurrentRole && <span className="ml-2"><Badge variant="default">You</Badge></span>}
                  </td>
                  <td className="px-4 py-2.5 text-center"><PermBadge resolved={perms.read} /></td>
                  <td className="px-4 py-2.5 text-center"><PermBadge resolved={perms.create} /></td>
                  <td className="px-4 py-2.5 text-center"><PermBadge resolved={perms.update} /></td>
                  <td className="px-4 py-2.5 text-center"><PermBadge resolved={perms.delete} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {expanded && (
        <div className="border-t border-border/50">
          <FieldTable fields={collection.fields} />
        </div>
      )}
    </div>
  )
}

function PermBadge({ resolved }: { resolved: ResolvedPermission }) {
  const key = String(resolved.level)
  const display = LEVEL_DISPLAY[key] ?? { label: key, variant: 'secondary' as BadgeVariant }
  const isDefaultDeny = resolved.source === 'default-deny'
  const isWildcard = resolved.source === 'wildcard'

  return (
    <span className={`inline-flex ${isDefaultDeny ? 'opacity-50 italic' : ''}`}>
      <Badge variant={isDefaultDeny ? 'secondary' : display.variant}>
        {display.label}
        {isWildcard && <span className="ml-0.5 opacity-60">*</span>}
      </Badge>
    </span>
  )
}

function FieldTable({ fields }: { fields: Record<string, FieldSchema> }) {
  const fieldEntries = Object.entries(fields)
  if (fieldEntries.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground" style={{ fontFamily: 'sans-serif' }}>No fields defined</p>
  }
  return (
    <div className="overflow-x-auto" style={{ fontFamily: 'sans-serif' }}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/30 bg-muted/20">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Field</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
            <th className="px-4 py-2 text-center font-medium text-muted-foreground">Required</th>
          </tr>
        </thead>
        <tbody>
          {fieldEntries.map(([name, field]) => (
            <tr key={name} className="border-b border-border/10 last:border-0">
              <td className="px-4 py-1.5"><code className="text-foreground font-medium">{name}</code></td>
              <td className="px-4 py-1.5 text-muted-foreground">{field.type}</td>
              <td className="px-4 py-1.5 text-center">
                {field.required && (
                  <svg className="w-3.5 h-3.5 text-success inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
