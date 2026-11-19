const PLAYER_SESSION_STORAGE_KEY = 'treasurebound_player_session_v1';

interface StoredPlayerSession {
  playerId: string;
  sessionToken: string;
}

let activePlayerId: string | null = null;
let activeSessionToken: string | null = null;

function readStorage(): StoredPlayerSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PLAYER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPlayerSession>;
    const playerId = typeof parsed.playerId === 'string' ? parsed.playerId.trim() : '';
    const sessionToken =
      typeof parsed.sessionToken === 'string' ? parsed.sessionToken.trim() : '';
    if (!playerId || !sessionToken) {
      window.sessionStorage.removeItem(PLAYER_SESSION_STORAGE_KEY);
      return null;
    }
    return { playerId, sessionToken };
  } catch {
    try {
      window.sessionStorage.removeItem(PLAYER_SESSION_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    return null;
  }
}

function writeStorage(session: StoredPlayerSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PLAYER_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore storage quota errors
  }
}

function removeStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PLAYER_SESSION_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function restorePlayerSession(): StoredPlayerSession | null {
  if (activePlayerId && activeSessionToken) {
    return { playerId: activePlayerId, sessionToken: activeSessionToken };
  }
  const stored = readStorage();
  if (!stored) return null;
  activePlayerId = stored.playerId;
  activeSessionToken = stored.sessionToken;
  return stored;
}

// Hydrate automatically on module load
restorePlayerSession();

export function setPlayerSession(playerId: string, token: string): void {
  const cleanId = playerId.trim();
  const cleanToken = token.trim();
  if (!cleanId || !cleanToken) {
    throw new Error('Data sesi pemain tidak valid.');
  }
  activePlayerId = cleanId;
  activeSessionToken = cleanToken;
  writeStorage({ playerId: cleanId, sessionToken: cleanToken });
}

export function getPlayerSessionToken(expectedPlayerId?: string): string {
  if (!activeSessionToken || !activePlayerId) {
    restorePlayerSession();
  }
  if (!activeSessionToken || !activePlayerId) {
    throw new Error('Sesi pemain tidak aktif. Silakan masuk ulang dari halaman karakter.');
  }
  if (expectedPlayerId && activePlayerId !== expectedPlayerId.trim()) {
    throw new Error('Identitas sesi pemain tidak cocok.');
  }
  return activeSessionToken;
}

export function tryGetPlayerSessionToken(expectedPlayerId?: string): string | null {
  if (!activeSessionToken || !activePlayerId) {
    restorePlayerSession();
  }
  if (!activeSessionToken || !activePlayerId) return null;
  if (expectedPlayerId && activePlayerId !== expectedPlayerId.trim()) return null;
  return activeSessionToken;
}

export function clearPlayerSession(): void {
  activePlayerId = null;
  activeSessionToken = null;
  removeStorage();
}
