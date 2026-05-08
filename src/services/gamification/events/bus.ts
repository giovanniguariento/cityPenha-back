/**
 * Mini event bus in-process para eventos de domínio de gamificação.
 *
 * As engines (mission/badge/level) NÃO escutam aqui — elas rodam de forma síncrona
 * dentro de `notify`. O bus serve para listeners adicionais (analytics, notificações push,
 * webhooks futuros) que queiram reagir ao mesmo evento sem acoplar ao engine.
 */
import type { DomainEventPayload, DomainEventType } from '../types';

export type DomainEventListener = (
  type: DomainEventType,
  payload: DomainEventPayload
) => void | Promise<void>;

const listeners: DomainEventListener[] = [];

export function onDomainEvent(listener: DomainEventListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

export async function emitDomainEvent(
  type: DomainEventType,
  payload: DomainEventPayload
): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(type, payload);
    } catch (err) {
      console.error(`[gamification.events] listener error on "${type}":`, err);
    }
  }
}
