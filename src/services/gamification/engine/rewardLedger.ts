/**
 * Aplica concessões/estornos de XP+coins ao usuário e registra no ledger imutável.
 *
 * É a única forma "sancionada" de mudar `user.xp` / `user.coins` no engine — assim a
 * tabela `reward_ledger` é sempre o histórico fiel do que o engine entregou.
 */
import type { Tx, RewardView } from '../types';

export interface ApplyRewardArgs {
  userId: string;
  source: string; // ex.: "MISSION:<id>" | "BADGE:<id>" | "LEVEL_UP:5" | "READ_XP:<postId>"
  reason: 'granted' | 'revoked';
  coinsDelta: number;
  xpDelta: number;
  meta?: Record<string, unknown>;
  tx: Tx;
}

/**
 * Aplica delta no usuário e cria entrada no ledger.
 * Retorna a view normalizada ou `null` quando ambos os deltas são zero (no-op).
 */
export async function applyReward(args: ApplyRewardArgs): Promise<RewardView | null> {
  const { userId, source, reason, coinsDelta, xpDelta, meta, tx } = args;
  if (coinsDelta === 0 && xpDelta === 0) return null;

  await tx.user.update({
    where: { id: userId },
    data: {
      xp: { increment: xpDelta },
      coins: { increment: coinsDelta },
    },
  });

  await tx.rewardLedger.create({
    data: {
      userId,
      source,
      reason,
      coinsDelta,
      xpDelta,
      meta: (meta ?? null) as never,
    },
  });

  return { source, reason, coinsDelta, xpDelta };
}

/**
 * Soma as recompensas já pagas (ou estornadas) de uma mesma `source` para impedir
 * dupla concessão. Útil para idempotência defensiva.
 */
export async function getNetLedgerForSource(tx: Tx, userId: string, source: string) {
  const rows = await tx.rewardLedger.findMany({
    where: { userId, source },
    select: { coinsDelta: true, xpDelta: true, reason: true },
  });
  let coins = 0;
  let xp = 0;
  for (const r of rows) {
    coins += r.coinsDelta;
    xp += r.xpDelta;
  }
  return { coins, xp, count: rows.length };
}
