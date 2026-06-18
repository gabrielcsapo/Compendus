/**
 * Demo kernel proving fabric code-mobility: a self-contained, platform-neutral
 * module the server distributes by content hash and any JS host executes
 * (Node harness today; the app's WKWebView host next). Kernels must be pure
 * compute: no filesystem, no network — payload in, result out.
 */
export default async function run(payload: {
  texts: string[];
}): Promise<{ stats: Array<{ words: number; unique: number; longest: string }> }> {
  const stats = payload.texts.map((t) => {
    const words = t.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    let longest = "";
    for (const w of words) if (w.length > longest.length) longest = w;
    return { words: words.length, unique: new Set(words).size, longest };
  });
  return { stats };
}
