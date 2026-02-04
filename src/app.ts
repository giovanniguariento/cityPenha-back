import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import homeRoutes from './routes/home.routes';
import postRoutes from './routes/post.routes';
import userRoutes from './routes/user.routes';

const app: Application = express();

// 1. Global Middlewares — compression first so responses are gzipped
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(cors());

// 2. Routes
app.use('/home', homeRoutes);
app.use('/post', postRoutes);
app.use('/user', userRoutes);

// 3. Global Error Handler (Middleware)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export default app;
