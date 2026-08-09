/**
 * Company-name identity, shared by the importer and the submission form.
 *
 * Both need exactly the same rules: the importer matched "Oracle(OFSS)" to
 * "Oracle (OFSS)" and it would be worse than useless if a student typing the
 * same thing created a second company. One implementation, two callers.
 *
 * Pure functions with no server dependency, so the ETL (a plain node script)
 * and the app can both import them.
 */

/** Legal-entity noise that carries no identity. */
const SUFFIX_NOISE = [
  "private limited",
  "pvt limited",
  "pvt ltd",
  "pvt",
  "limited",
  "ltd",
  "llp",
  "inc",
  "incorporated",
  "corporation",
  "corp",
  "co",
  "company",
  "technologies",
  "technology",
  "tech solutions",
  "solutions",
  "software solutions",
  "india",
  "india pvt",
  "group",
  "groups",
  "gmbh",
  "plc",
  "sa",
  "se",
  "ag",
  "nv",
];

/**
 * Exact identity key. Case, punctuation and spacing are ignored; everything
 * else is preserved, so "IBM (ISL)" and "IBM (ISDL)" stay distinct.
 */
export function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Aggressive key used only to SUGGEST merges to a human. Strips suffix noise
 * and parenthesised qualifiers. Two different companies can collide here, which
 * is exactly why this feeds a review file and never an automatic merge.
 */
export function similarityKey(name: string): string {
  let working = name.toLowerCase().trim();
  working = working.replace(/\([^)]*\)/g, " ");
  working = working.replace(/[^a-z0-9]+/g, " ").trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIX_NOISE) {
      if (working.endsWith(` ${suffix}`)) {
        working = working.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }

  return working.replace(/\s+/g, "");
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
