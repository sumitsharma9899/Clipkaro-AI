export async function parseApiJson<T>(res: Response): Promise<T> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
      throw new Error(
        res.status >= 500
          ? 'The server took too long to respond. Please try again or upload an MP4/MOV file.'
          : 'Server returned an unexpected page instead of JSON. Please refresh and try again.'
      );
    }
    throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
  }
}
