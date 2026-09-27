// Small fetch helper: JSON with a timeout and one retry. Node 18+ has fetch built in.
export async function getJSON(url, { timeoutMs = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'paddock-pavilion/1.0 (+self-hosted sports schedule board)', accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "2026-10-04T14:00:00+0900" -> "2026-10-04T05:00:00.000Z"
export function toUtcIso(s) {
  if (!s) return null;
  const fixed = String(s).replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z');
}

export function titleCase(s) {
  const small = new Set(['of', 'the', 'and', 'de', 'du', 'la', 'del']);
  return String(s)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
