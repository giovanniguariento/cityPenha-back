import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';

// Pool size: increase if you have many concurrent requests (default 10, max 50)
const connectionLimit = Math.min(
    Math.max(Number(process.env.DATABASE_POOL_SIZE) || 10, 2),
    50
);

// connectTimeout: fail fast if DB is unreachable instead of hanging (ms)
const connectTimeout = Number(process.env.DATABASE_CONNECT_TIMEOUT) || 10_000;

const adapter = new PrismaMariaDb({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    connectionLimit,
    connectTimeout,
    port: Number(process.env.DATABASE_PORT) || 3306,
});

declare const global: typeof globalThis & { prisma?: PrismaClient };

const prisma = global.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

export { prisma };