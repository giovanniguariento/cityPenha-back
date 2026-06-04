import pino from 'pino';

const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

function resolveLogLevel(): pino.Level {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && LEVELS.has(env)) return env as pino.Level;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
}

export const logger = pino({
  level: resolveLogLevel(),
});

export const LOG_SLOW_MS = Number(process.env.LOG_SLOW_MS) || 3000;
