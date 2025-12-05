import express, { Application, Request, Response, NextFunction } from 'express';
import homeRoutes from './routes/home.routes';
import postRoutes from './routes/post.routes'
import cors from "cors";

const app: Application = express();

// 1. Global Middlewares
app.use(express.json());
app.use(cors())

// 2. Routes
app.use('/home', homeRoutes);
app.use('/post', postRoutes);

// 3. Global Error Handler (Middleware)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export default app;
