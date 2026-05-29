/**
 * Pure, DB-free person-name matching for entity resolution.
 *
 * GLiNER yields many surface forms of one person ("Mr. Tanimoto", "Tanimoto",
 * "Reverend Mr. Tanimoto") that exact-normalized matching leaves as separate
 * entities, fragmenting the graph. These helpers merge title variants of the
 * *same* core name — but deliberately never across a gender/title conflict
 * ("Mr." vs "Mrs.", "Dr. Sasaki" vs "Miss Sasaki" are different people), and
 * never a bare surname into a fuller name when more than one candidate shares
 * that surname (that would be a guess). Conservative by design: collapse the
 * obvious duplicates, abstain whenever the merge is ambiguous.
 *
 * Kept free of any DB import so it is unit-testable in isolation.
 */

const MALE_TITLES = new Set([
  "mr",
  "mister",
  "sir",
  "lord",
  "father",
  "fr",
  "brother",
  "king",
  "emperor",
  "pope",
]);
const FEMALE_TITLES = new Set([
  "mrs",
  "ms",
  "miss",
  "lady",
  "dame",
  "mother",
  "sister",
  "queen",
  "empress",
  "madam",
  "madame",
]);
const TITLES = new Set([
  ...MALE_TITLES,
  ...FEMALE_TITLES,
  "dr",
  "prof",
  "professor",
  "rev",
  "reverend",
  "st",
  "saint",
  "captain",
  "capt",
  "colonel",
  "col",
  "general",
  "gen",
  "major",
  "lieutenant",
  "lt",
  "sergeant",
  "sgt",
  "president",
  "pres",
]);

export interface ParsedName {
  titles: Set<string>;
  coreTokens: string[];
  core: string;
}

/** Split a normalized name into honorific titles and the core name tokens. */
export function parsePersonName(norm: string): ParsedName {
  const titles = new Set<string>();
  const coreTokens: string[] = [];
  for (const tok of norm.split(" ")) {
    if (!tok) continue;
    if (TITLES.has(tok)) titles.add(tok);
    else coreTokens.push(tok);
  }
  return { titles, coreTokens, core: coreTokens.join(" ") };
}

function genderOf(titles: Set<string>): "m" | "f" | null {
  let m = false;
  let f = false;
  for (const t of titles) {
    if (MALE_TITLES.has(t)) m = true;
    if (FEMALE_TITLES.has(t)) f = true;
  }
  return m && f ? null : m ? "m" : f ? "f" : null;
}

/** One title set is a refinement of the other (e.g. {mr} ⊆ {reverend, mr}). */
function titlesCompatible(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

function genderCompatible(a: "m" | "f" | null, b: "m" | "f" | null): boolean {
  return !(a === "m" && b === "f") && !(a === "f" && b === "m");
}

export interface NameCandidate {
  id: string;
  normalizedName: string;
}

/**
 * Find the existing person entity that `norm` is a surface variant of, or null
 * if there's no confident, unambiguous match.
 */
export function matchPersonName<T extends NameCandidate>(norm: string, candidates: T[]): T | null {
  const ip = parsePersonName(norm);
  if (ip.coreTokens.length === 0) return null;
  const ig = genderOf(ip.titles);
  const parsed = candidates.map((c) => ({ c, p: parsePersonName(c.normalizedName) }));

  // Same core name, compatible titles/gender (title variants of one person).
  const coreMatches = parsed.filter(
    (x) =>
      x.p.core === ip.core &&
      titlesCompatible(ip.titles, x.p.titles) &&
      genderCompatible(ig, genderOf(x.p.titles)),
  );
  if (ip.coreTokens.length === 1) {
    // Single-token core (a surname): only merge if unambiguous.
    if (coreMatches.length === 1) return coreMatches[0].c;
  } else if (coreMatches.length > 0) {
    // Multi-token core is a strong signal; pick the fullest existing form.
    return pickFuller(coreMatches).c;
  }

  // Bare surname → a fuller "Given Surname", but only when exactly one fuller
  // candidate shares that surname (otherwise it's a guess between two people).
  if (ip.coreTokens.length === 1) {
    const surname = ip.coreTokens[0];
    const subs = parsed.filter(
      (x) =>
        x.p.coreTokens.length >= 2 &&
        x.p.coreTokens[x.p.coreTokens.length - 1] === surname &&
        titlesCompatible(ip.titles, x.p.titles) &&
        genderCompatible(ig, genderOf(x.p.titles)),
    );
    if (subs.length === 1) return subs[0].c;
  }

  return null;
}

function pickFuller<T extends { c: NameCandidate; p: ParsedName }>(xs: T[]): T {
  return xs.reduce((best, x) =>
    x.p.coreTokens.length > best.p.coreTokens.length ||
    (x.p.coreTokens.length === best.p.coreTokens.length &&
      x.c.normalizedName.length > best.c.normalizedName.length)
      ? x
      : best,
  );
}
