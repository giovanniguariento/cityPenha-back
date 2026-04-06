import express, { Application } from 'express';
import cors from 'cors';
import compression from 'compression';
import homeRoutes from './routes/home.routes';
import missionRoutes from './routes/mission.routes';
import postRoutes from './routes/post.routes';
import userRoutes from './routes/user.routes';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

const app: Application = express();

// 1. Global Middlewares — compression first so responses are gzipped
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(cors());

// 2. Routes
app.use('/home', homeRoutes);
app.use('/mission', missionRoutes);
app.use('/post', postRoutes);
app.use('/user', userRoutes);

// 3. 404 + global error handler
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
