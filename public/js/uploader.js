// Envois robustes (mauvaise connexion) : réessais avec attente croissante, pause pendant une coupure réseau.

/** Réseau coupé ou instable (pas de statut HTTP), erreurs serveur, délai dépassé, trop de requêtes : on réessaie. Le reste est définitif. */
export const isRetryable = (err) => {
  const s = err?.status;
  return !s || s >= 500 || s === 408 || s === 429;
};

export const DEFAULT_DELAYS = [2000, 5000, 12000, 30000];

/** Résout quand le navigateur est de nouveau en ligne (tout de suite s'il l'est déjà). */
export function waitForOnline(target = globalThis) {
  if (target.navigator?.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => {
    const h = () => { target.removeEventListener("online", h); resolve(); };
    target.addEventListener("online", h);
  });
}

/**
 * Exécute `fn` jusqu'à réussite. Hors ligne : on attend le retour du réseau SANS consommer de tentative.
 * En ligne : une tentative de plus après chaque attente de `delays` ; au-delà, l'erreur est relancée.
 * Les erreurs non réessayables (415, 413, 401…) sont relancées tout de suite.
 */
export async function withRetry(fn, {
  delays = DEFAULT_DELAYS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  isOnline = () => globalThis.navigator?.onLine !== false,
  waitOnline = () => waitForOnline(),
  onRetry,
  onOffline,
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      if (!isOnline()) {
        onOffline?.();
        await waitOnline();
        continue;
      }
      if (attempt >= delays.length) throw err;
      onRetry?.({ attempt: attempt + 1, max: delays.length, delay: delays[attempt], err });
      await sleep(delays[attempt]);
      attempt++;
    }
  }
}
