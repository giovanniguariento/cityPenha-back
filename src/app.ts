import express, { Application } from 'express';
import cors from 'cors';
import compression from 'compression';
import homeRoutes from './routes/home.routes';
import missionRoutes from './routes/mission.routes';
import postRoutes from './routes/post.routes';
import userRoutes from './routes/user.routes';
import discoveryRoutes from './routes/discovery.routes';
import adminRoutes from './routes/admin.routes';
import commentRoutes from './routes/comment.routes';
import ogRoutes from './routes/og.routes';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { postViewRateLimit } from './middleware/viewRateLimit';

const app: Application = express();

// Behind reverse proxy (load balancer) — required for accurate req.ip in rate limits
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// 1. Global Middlewares — compression first so responses are gzipped
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(cors());
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

// 3. 404 + global error handler
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
