import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { ConflictError } from './repository';

export type Clip = { x: number; y: number; width: number; height: number };

/** Parse a "x,y,w,h" env string into a clip rectangle, or null if malformed. */
export function parseClip(s: string | undefined): Clip | null {
  if (!s) return null;
  const parts = s.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

function parseViewport(s: string | undefined): { width: number; height: number } {
  const parts = (s ?? '').split(',').map((n) => Number(n.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return { width: parts[0]!, height: parts[1]! };
  }
  return { width: 1280, height: 800 };
}

export type CaptureResult = { signal: Buffer; pixel: Buffer } | { error: string };

export interface T1moCapturer {
  readonly cacheMs: number;
  /** null when ready; a message (→ HTTP 400) when misconfigured. */
  configError(): string | null;
  /** Capture two clip regions per ticker. Keyed by UPPERCASE ticker. Throws ConflictError if busy. */
  capture(tickers: string[]): Promise<Record<string, CaptureResult>>;
}

/** Build the real Vivaldi/Playwright capturer, or null when the feature flag is off. */
export function createPlaywrightCapturer(env: NodeJS.ProcessEnv): T1moCapturer | null {
  if (env.VITE_T1MO_CAPTURE !== 'true') return null;

  const urlTemplate = env.VITE_T1MO_URL_TEMPLATE ?? '';
  const signalClip = parseClip(env.T1MO_SIGNAL_CLIP);
  const pixelClip = parseClip(env.T1MO_PIXEL_CLIP);
  const viewport = parseViewport(env.T1MO_VIEWPORT);
  const vivaldiPath = env.T1MO_VIVALDI_PATH ?? '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi';
  const userDataDir = env.T1MO_USER_DATA_DIR ?? '/tmp/vivaldi-automation-profile';
  const cacheMs = (Number(env.T1MO_CACHE_MINUTES) || 15) * 60_000;
  const DEBUG_PORT = 9222; // ponytail: fixed CDP port; make env-configurable if it ever collides

  let inProgress = false;
  const url = (ticker: string) => urlTemplate.replace(/\{\{TICKER\}\}/g, encodeURIComponent(ticker.toUpperCase()));

  return {
    cacheMs,
    configError() {
      if (!urlTemplate) return 'VITE_T1MO_URL_TEMPLATE is not set';
      if (!signalClip) return 'T1MO_SIGNAL_CLIP must be "x,y,w,h"';
      if (!pixelClip) return 'T1MO_PIXEL_CLIP must be "x,y,w,h"';
      return null;
    },
    async capture(tickers) {
      if (inProgress) throw new ConflictError('a T1mo capture is already in progress');
      inProgress = true;
      const results: Record<string, CaptureResult> = {};
      const proc = spawn(vivaldiPath, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`], { detached: true, stdio: 'ignore' });
      try {
        await new Promise((r) => setTimeout(r, 2000)); // let Vivaldi open the debug port
        const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
        try {
          const context = browser.contexts()[0] ?? (await browser.newContext());
          const page = context.pages()[0] ?? (await context.newPage());
          await page.setViewportSize(viewport);
          for (const ticker of tickers) {
            const key = ticker.toUpperCase();
            try {
              await page.goto(url(ticker), { waitUntil: 'networkidle' });
              const signal = await page.screenshot({ clip: signalClip! });
              const pixel = await page.screenshot({ clip: pixelClip! });
              results[key] = { signal, pixel };
            } catch (err) {
              results[key] = { error: (err as Error)?.message ?? 'capture failed' };
            }
          }
        } finally {
          await browser.close();
        }
      } catch (err) {
        // Whole-run failure (Vivaldi missing, CDP connect fail): mark every ticker.
        const msg = (err as Error)?.message ?? 'browser launch failed';
        for (const t of tickers) results[t.toUpperCase()] ??= { error: msg };
      } finally {
        proc.kill();
        inProgress = false;
      }
      return results;
    },
  };
}
