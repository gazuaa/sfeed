import type { D1DatabaseLike } from './types';

// subscriptions.paused_at arrived after launch (migrations/0004). Until a
// database has it, every query behaves as if no feed were paused, so a
// deploy never breaks while the migration is still to be applied.
const support = new WeakMap<D1DatabaseLike, { supported: boolean; at: number }>();
export async function pauseSupported(db: D1DatabaseLike): Promise<boolean> {
  const known = support.get(db);
  if (known && (known.supported || Date.now() - known.at < 60_000)) return known.supported;
  const supported = await db.prepare('SELECT paused_at FROM subscriptions LIMIT 0').all().then(() => true, () => false);
  support.set(db, { supported, at: Date.now() });
  return supported;
}

/** Articles a paused subscription still shows: those stored before it was paused. */
export const shownToSubscriber = (supported: boolean, s = 's', a = 'a') =>
  supported ? `(${s}.paused_at IS NULL OR ${a}.created_at <= ${s}.paused_at)` : '1=1';
export const pausedAtColumn = (supported: boolean, s = 's') => supported ? `${s}.paused_at` : 'NULL';
