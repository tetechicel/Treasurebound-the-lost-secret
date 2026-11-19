import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type SupabaseConfigReason =
  | 'missing_env'
  | 'invalid_url'
  | 'invalid_key_type'
  | 'network_error';

export interface SupabaseInitResult {
  configured: boolean;
  reason?: SupabaseConfigReason;
}

interface RuntimeConfigResponse {
  configured?: boolean;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  reason?: SupabaseConfigReason;
}

let supabaseClient: SupabaseClient | null = null;
let configuredState = false;
let lastReason: SupabaseConfigReason | undefined;
let initPromise: Promise<SupabaseInitResult> | null = null;

function isValidSupabaseUrl(value: string): boolean {
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

function isSecretKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('sb_secret_')) return true;

  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
      const decoded = atob(padded);
      const payload = JSON.parse(decoded) as { role?: unknown };
      if (typeof payload.role === 'string' && payload.role.toLowerCase() === 'service_role') {
        return true;
      }
    } catch {
      // Ignore malformed JWT payloads
    }
  }
  return false;
}

function initializeClient(url: string, publishableKey: string): SupabaseInitResult {
  const cleanUrl = url.trim();
  const cleanKey = publishableKey.trim();

  if (
    !cleanUrl ||
    !cleanKey ||
    cleanUrl.includes('YOUR_PROJECT_ID') ||
    cleanKey.includes('YOUR_SUPABASE_ANON_KEY') ||
    cleanKey.includes('YOUR_SUPABASE_PUBLISHABLE_KEY')
  ) {
    supabaseClient = null;
    configuredState = false;
    lastReason = 'missing_env';
    return { configured: false, reason: 'missing_env' };
  }

  if (!isValidSupabaseUrl(cleanUrl)) {
    supabaseClient = null;
    configuredState = false;
    lastReason = 'invalid_url';
    return { configured: false, reason: 'invalid_url' };
  }

  if (isSecretKey(cleanKey)) {
    supabaseClient = null;
    configuredState = false;
    lastReason = 'invalid_key_type';
    return { configured: false, reason: 'invalid_key_type' };
  }

  supabaseClient = createClient(cleanUrl, cleanKey, {
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });
  configuredState = true;
  lastReason = undefined;
  return { configured: true };
}

function tryStaticFallback(): SupabaseInitResult | null {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
  if (!envUrl || !envKey) {
    return null;
  }
  return initializeClient(envUrl, envKey);
}

export async function initSupabaseRuntime(forceRefresh = false): Promise<SupabaseInitResult> {
  if (!forceRefresh && configuredState && supabaseClient) {
    return { configured: true };
  }

  if (!forceRefresh && initPromise) {
    return initPromise;
  }

  initPromise = (async (): Promise<SupabaseInitResult> => {
    try {
      const response = await fetch('/api/supabase-config', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const data = (await response.json()) as RuntimeConfigResponse;
        if (data.configured && data.supabaseUrl && data.supabasePublishableKey) {
          return initializeClient(data.supabaseUrl, data.supabasePublishableKey);
        }

        // Fall back to optional Vite env vars only if server runtime vars aren't configured
        const fallback = tryStaticFallback();
        if (fallback?.configured) {
          return fallback;
        }

        supabaseClient = null;
        configuredState = false;
        lastReason = data.reason ?? 'missing_env';
        return { configured: false, reason: lastReason };
      }
    } catch {
      const fallback = tryStaticFallback();
      if (fallback?.configured) {
        return fallback;
      }

      supabaseClient = null;
      configuredState = false;
      lastReason = 'network_error';
      return { configured: false, reason: 'network_error' };
    }

    const fallback = tryStaticFallback();
    if (fallback?.configured) {
      return fallback;
    }

    supabaseClient = null;
    configuredState = false;
    lastReason = 'missing_env';
    return { configured: false, reason: 'missing_env' };
  })();

  try {
    return await initPromise;
  } finally {
    // Allow future explicit forceRefresh calls; reset initPromise if not configured so retries work cleanly
    if (!configuredState) {
      initPromise = null;
    }
  }
}

export async function ensureSupabaseReady(): Promise<SupabaseInitResult> {
  if (configuredState && supabaseClient) {
    return { configured: true };
  }
  return initSupabaseRuntime(false);
}

export function getIsSupabaseConfigured(): boolean {
  return configuredState && Boolean(supabaseClient);
}

export function getSupabaseConfigReason(): SupabaseConfigReason | undefined {
  return lastReason;
}

export function requireSupabase(): SupabaseClient {
  if (!supabaseClient || !configuredState) {
    throw new Error(
      'Supabase belum terkonfigurasi. Tambahkan SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY pada Google AI Studio Settings -> Secrets.'
    );
  }
  return supabaseClient;
}
