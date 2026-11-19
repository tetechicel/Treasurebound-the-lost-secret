import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ConfigReason = 'missing_env' | 'invalid_url' | 'invalid_key_type';

interface PublicSupabaseConfig {
  configured: boolean;
  supabaseUrl: string;
  supabasePublishableKey: string;
  reason?: ConfigReason;
}

function isValidHttpUrl(value: string): boolean {
  if (!value || value.includes('YOUR_PROJECT_ID')) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isSecretSupabaseKey(key: string): boolean {
  if (!key) return false;
  const trimmed = key.trim();

  // Supabase new-format secret keys always start with sb_secret_
  if (trimmed.startsWith('sb_secret_')) {
    return true;
  }

  // Legacy JWT anon/service_role keys carry a "role" claim in the payload
  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      const payload = JSON.parse(decoded) as { role?: unknown };
      if (typeof payload.role === 'string' && payload.role.toLowerCase() === 'service_role') {
        return true;
      }
    } catch {
      // Ignore malformed JWT payloads; let downstream checks validate
    }
  }

  return false;
}

function resolvePublicSupabaseConfig(): PublicSupabaseConfig {
  // Read ONLY public configuration variables. Never read SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabasePublishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (
    !supabaseUrl ||
    !supabasePublishableKey ||
    supabaseUrl.includes('YOUR_PROJECT_ID') ||
    supabasePublishableKey.includes('YOUR_SUPABASE_ANON_KEY') ||
    supabasePublishableKey.includes('YOUR_SUPABASE_PUBLISHABLE_KEY')
  ) {
    return {
      configured: false,
      supabaseUrl: '',
      supabasePublishableKey: '',
      reason: 'missing_env',
    };
  }

  if (!isValidHttpUrl(supabaseUrl)) {
    return {
      configured: false,
      supabaseUrl: '',
      supabasePublishableKey: '',
      reason: 'invalid_url',
    };
  }

  if (isSecretSupabaseKey(supabasePublishableKey)) {
    return {
      configured: false,
      supabaseUrl: '',
      supabasePublishableKey: '',
      reason: 'invalid_key_type',
    };
  }

  return {
    configured: true,
    supabaseUrl,
    supabasePublishableKey,
  };
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.disable('x-powered-by');

  // Safe runtime configuration endpoint exposing ONLY public Supabase URL and Publishable Key.
  app.get('/api/supabase-config', (_req, res) => {
    const config = resolvePublicSupabaseConfig();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(config);
  });

  app.get('/api/health', (_req, res) => {
    const config = resolvePublicSupabaseConfig();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      supabaseConfigured: config.configured,
      mode: isProduction ? 'production' : 'development',
    });
  });

  // Never let unknown /api/* paths fall through to SPA index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');

    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    app.get('*', (_req, res) => {
      if (!fs.existsSync(indexHtmlPath)) {
        res.status(503).send('Application bundle not found. Run npm run build first.');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtmlPath);
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`TREASUREBOUND server listening on http://0.0.0.0:${port} (${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start TREASUREBOUND server:', err);
  process.exit(1);
});
