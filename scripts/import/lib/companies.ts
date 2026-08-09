/**
 * Company identity.
 *
 * Year-over-year company comparison is an explicit requirement, and it is
 * impossible while "Eternal(Zomato)" and "Eternal" are two companies. The
 * source workbooks contain, among others:
 *
 *   Eternal(Zomato) / Eternal              same company, renamed
 *   IBM (ISDL) / (ISL) / (CIO) / IBM(KPH)  four arms of one company
 *   inMobi Groups / Inmobi / Inmobi Glance Glance is an inMobi subsidiary
 *   Oracle(OFSS) / Oracle (OFSS)           whitespace only
 *   HCL Tech / HCLTech                     whitespace only
 *   HPE / HPE (Juniper)                    parent and acquisition
 *   Mysa / Mysa Innovations Pvt Ltd        suffix noise
 *
 * Normalisation collapses the mechanical differences. The genuinely editorial
 * ones — is Glance part of inMobi? — are declared in KNOWN_GROUPS below, where
 * a maintainer can see and revise them, rather than being inferred by a
 * similarity score that will merge two unrelated startups one day.
 */

// The name-identity rules are shared with the submission form, so a student
// typing "Oracle (OFSS)" resolves to the same company the importer created.
// One implementation, two callers.
export { normalizeCompanyName, similarityKey, slugify } from "@/lib/companies/name";
import { normalizeCompanyName } from "@/lib/companies/name";

/** Trims the trailing status notes the sheets append to company names. */
export function cleanCompanyName(raw: string): {
  name: string;
  inlineNote: string | null;
} {
  const text = String(raw).replace(/\s+/g, " ").trim();

  // "Infosys (DID NOT PROCEED)" — a status, not part of the name.
  const status = /\s*\((DID NOT PROCEED|Hackathon Based|Summer Internship|CFG)\)\s*$/i.exec(text);
  if (status) {
    return { name: text.slice(0, status.index).trim(), inlineNote: status[1] ?? null };
  }

  return { name: text, inlineNote: null };
}

export type CompanyGroup = {
  /** Canonical display name for the parent. */
  parent: string;
  /** Child entities that should hang off the parent, by their sheet spelling. */
  children?: string[];
  /** Alternative spellings that ARE the parent, not a child of it. */
  aliases?: string[];
};

/**
 * Editorial groupings, declared explicitly.
 *
 * Only entries a maintainer can defend belong here. Everything else is left as
 * a separate company and, where the names look suspiciously alike, raised in
 * the review file for a human to decide.
 */
export const KNOWN_GROUPS: CompanyGroup[] = [
  {
    parent: "IBM",
    children: ["IBM (ISDL)", "IBM (ISL)", "IBM (CIO)", "IBM(KPH)"],
  },
  {
    parent: "Eternal (Zomato)",
    aliases: ["Eternal", "Eternal(Zomato)", "Zomato"],
  },
  {
    parent: "inMobi",
    aliases: ["Inmobi", "inMobi Groups", "InMobi Group"],
    children: ["Inmobi Glance", "Glance"],
  },
  {
    parent: "Oracle (OFSS)",
    aliases: ["Oracle(OFSS)", "Oracle (OFSS)", "OFSS"],
  },
  {
    parent: "HCLTech",
    aliases: ["HCL Tech", "HCLTech", "HCL Technologies"],
  },
  {
    parent: "HPE",
    aliases: ["Hewlett Packard Ent.", "Hewlett Packard Enterprise"],
    children: ["HPE (Juniper)"],
  },
  {
    parent: "Mysa",
    aliases: ["Mysa Innovations Pvt Ltd", "Mysa Innovations"],
  },
  {
    parent: "4Good.AI",
    aliases: ["4Good AI", "4GoodAI", "4Good.AI"],
  },
  {
    parent: "Walmart",
    children: ["Walmart Labs", "Walmart Global Tech"],
  },
  {
    parent: "JPMorgan Chase",
    aliases: ["JPMC"],
    children: ["JPMC (Summer Internship)", "JPMC (CFG)"],
  },
  {
    parent: "Netcore Cloud",
    aliases: ["NetCore", "Netcore", "Netcore Cloud"],
  },
  {
    parent: "Vyapar",
    aliases: ["Vyapar Apps", "Vyapar"],
  },
  {
    parent: "Rubrik India Pvt Ltd",
    aliases: ["Rubrik India Pvt. Ltd", "Rubrik India Pvt Ltd", "Rubrik"],
  },
  {
    parent: "Progress",
    aliases: ["Progress Software"],
  },
  {
    parent: "eLitmus",
    aliases: ["eLitmus", "Elitmus"],
  },
  {
    parent: "TheMathCompany",
    aliases: ["The Math Company", "TheMathCompany"],
  },
  {
    parent: "Epsilon",
    aliases: ["Epsilon"],
  },
  {
    parent: "Ather Energy",
    aliases: ["Ather", "Ather Energy"],
  },
  {
    parent: "Sixt",
    aliases: ["Sixt RnD India", "Sixt R&D India", "Sixt"],
  },
  {
    parent: "Arctic Wolf",
    aliases: ["Arctic Wolf"],
  },
  {
    parent: "Cognizant",
    aliases: ["Cognizant"],
  },
  {
    parent: "SaiHarmony Solutions",
    aliases: ["SaiHarmony Solutions India Pvt Ltd"],
  },
  {
    parent: "Orange Business",
    aliases: ["Orange Business India", "Orange Business"],
  },
  {
    parent: "Mirai Labs",
    aliases: ["mirAI", "Mirai Labs"],
  },
];

/** Builds a lookup from every declared spelling to its canonical parent/child. */
export function buildKnownAliasIndex(): Map<
  string,
  { canonical: string; parent: string | null }
> {
  const index = new Map<string, { canonical: string; parent: string | null }>();

  for (const group of KNOWN_GROUPS) {
    index.set(normalizeCompanyName(group.parent), {
      canonical: group.parent,
      parent: null,
    });

    for (const alias of group.aliases ?? []) {
      index.set(normalizeCompanyName(alias), { canonical: group.parent, parent: null });
    }

    for (const child of group.children ?? []) {
      index.set(normalizeCompanyName(child), {
        canonical: child,
        parent: group.parent,
      });
    }
  }

  return index;
}

