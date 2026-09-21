/** Pure authorization decision. Inputs must come from a trusted server-side session
 * and persisted resource ownership, NEVER request bodies, cookies or URL claims.
 * Not authentication; not wired to HTTP routes. */
const permissions = Object.freeze({
  admin: ['property:read', 'property:edit', 'reservation:read', 'finance:read'],
  operator: ['property:read', 'reservation:read'],
  owner: ['property:read', 'reservation:read', 'finance:read'],
});
const deny = () => ({ allowed: false, reason: 'ACCESS_DENIED' });
export function authorize({ session, resource, action, now } = {}) {
  if (!session || !resource || !Number.isSafeInteger(now)) return deny();
  if (typeof session.subjectId !== 'string' || !session.subjectId.trim()) return deny();
  if (session.revoked !== false || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now) return deny();
  if (typeof session.organizationId !== 'string' || !session.organizationId.trim() || session.organizationId !== resource.organizationId) return deny();
  if (!Object.hasOwn(permissions, session.role) || !permissions[session.role].includes(action)) return deny();
  if (typeof resource.propertyId !== 'string' || !resource.propertyId.trim()) return deny();
  // Even administrators remain within their organization. Owners require an
  // explicit server-verified assignment for each property, never a wildcard.
  if (session.role === 'owner' && (!Array.isArray(session.propertyIds) || !session.propertyIds.includes(resource.propertyId))) return deny();
  return { allowed: true, reason: 'POLICY_MATCH' };
}
