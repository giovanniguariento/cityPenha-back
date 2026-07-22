import express, { Application } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import homeRoutes from './routes/home.routes';
import missionRoutes from './routes/mission.routes';
import postRoutes from './routes/post.routes';
import userRoutes from './routes/user.routes';
import discoveryRoutes from './routes/discovery.routes';
import adminRoutes from './routes/admin.routes';
import commentRoutes from './routes/comment.routes';
import ogRoutes from './routes/og.routes';
import sitemapRoutes from './routes/sitemap.routes';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

const app: Application = express();

// Behind reverse proxy (load balancer) — required for accurate req.ip in rate limits
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

function parseCorsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    // Dev-friendly default when unset; production must set CORS_ORIGINS
    if (process.env.NODE_ENV === 'production') {
      return [];
    }
    return true;
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

const corsOrigins = parseCorsOrigins();

// 1. Global Middlewares — compression first so responses are gzipped
app.use(compression());
app.use(
  helmet({
    // API returns JSON/images; CSP is enforced at the nginx edge for HTML
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '512kb' }));
app.use(
  cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);
app.use(requestLogger);

// 2. Routes
app.use('/home', homeRoutes);
app.use('/mission', missionRoutes);
app.use('/post', postRoutes);
app.use('/user', userRoutes);
app.use('/discovery', discoveryRoutes);
app.use('/admin', adminRoutes);
app.use('/comment', commentRoutes);
app.use('/og-image', ogRoutes);
app.use('/sitemap', sitemapRoutes);

// 3. 404 + global error handler
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
