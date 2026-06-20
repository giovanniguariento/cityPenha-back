import { serialize, unserialize } from 'php-serialize';

const PPMA_EDIT_OWN_PROFILE = 'ppma_edit_own_profile';

/** WordPress user `wp_capabilities` meta: PHP map of role/cap => boolean. */
export function hasCapability(serialized: string, cap: string): boolean {
  try {
    const parsed = unserialize(serialized || 'a:0:{}') as Record<string, boolean>;
    return parsed[cap] === true;
  } catch {
    return serialized.includes(`s:${cap.length}:"${cap}";b:1`);
  }
}

export function addCapability(serialized: string, cap: string): string {
  let caps: Record<string, boolean>;
  try {
    caps = (unserialize(serialized || 'a:0:{}') as Record<string, boolean>) ?? {};
  } catch {
    caps = { author: true };
  }
  if (caps[cap] === true) {
    return serialized;
  }
  caps[cap] = true;
  return serialize(caps);
}

/** `wp_user_roles` option: map of role slug => { name, capabilities }. */
export function roleHasCapability(serialized: string, role: string, cap: string): boolean {
  try {
    const roles = unserialize(serialized) as Record<
      string,
      { capabilities?: Record<string, boolean> }
    >;
    return roles[role]?.capabilities?.[cap] === true;
  } catch {
    return false;
  }
}

export function addRoleCapability(serialized: string, role: string, cap: string): string {
  let roles: Record<string, { name?: string; capabilities?: Record<string, boolean> }>;
  try {
    roles = (unserialize(serialized || 'a:0:{}') as typeof roles) ?? {};
  } catch {
    return serialized;
  }
  const roleData = roles[role];
  if (!roleData || typeof roleData !== 'object') {
    return serialized;
  }
  const capabilities = { ...(roleData.capabilities ?? {}) };
  if (capabilities[cap] === true) {
    return serialized;
  }
  capabilities[cap] = true;
  roles[role] = { ...roleData, capabilities };
  return serialize(roles);
}

export { PPMA_EDIT_OWN_PROFILE };
