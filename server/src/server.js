// server/src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import lotRoutes from './routes/lots.js';

const app = express();

/** CORS robuste (OK pour dev + prod) */
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

/** API */
app.get('/api', (_req, res) => res.json({ ok: true, name: 'offer-compare-server' }));
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/lots', lotRoutes);

/** FRONT (same-origin) */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ATTENTION: on sert depuis server/public
const publicDir = path.resolve(__dirname, '../public');

app.use(express.static(publicDir));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).end();
  res.sendFile(path.join(publicDir, 'index.html'));
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
