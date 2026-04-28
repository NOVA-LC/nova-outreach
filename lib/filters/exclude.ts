// Carrier-affiliation filter: drop agents linked to AIL / Globe Life / Liberty National
// (Torchmark family — captive networks Tyler asked to avoid).
//
// We detect via four signals: email domain, brokerage/agency name, signature/bio text,
// and any "carriers" array the scraper may have populated. False positives are tolerable
// (we'd rather skip a borderline match than email a captive agent).

const TORCHMARK_DOMAINS = new Set([
  "ailife.com",
  "ail.com",
  "globelife.com",
  "globelifeinsurance.com",
  "libnat.com",
  "libertynational.com",
  "torchmarkcorp.com",
  "globe.life",
  "ailmiles.com",
]);

const TORCHMARK_BRAND_RE = new RegExp(
  [
    "\\bAIL\\b",
    "American Income Life",
    "Globe Life",
    "Globe ?Life ?Insurance",
    "Liberty National",
    "Liberty Nat'l",
    "Torchmark",
    "United American Insurance",
    "Family Heritage Life",
  ].join("|"),
  "i",
);

export interface AgentLike {
  email?: string | null;
  brokerage?: string | null;
  agency?: string | null;
  full_name?: string | null;
  raw_payload?: any;
  carriers?: string[] | null;
}

export interface ExclusionResult {
  excluded: boolean;
  reason?:
    | "ail"
    | "globe_life"
    | "liberty_national"
    | "torchmark_family"
    | "role_filter"
    | "duplicate"
    | "manual"
    | "missing_email"
    | "freemail_only_no_brokerage";
  detail?: string;
}

export function classify(agent: AgentLike): ExclusionResult {
  if (!agent.email || !/^.+@.+\..+$/.test(agent.email)) {
    return { excluded: true, reason: "missing_email" };
  }
  const email = agent.email.toLowerCase().trim();
  const domain = email.split("@")[1] ?? "";

  if (TORCHMARK_DOMAINS.has(domain)) {
    return { excluded: true, reason: "torchmark_family", detail: `domain:${domain}` };
  }

  const haystack = [
    agent.brokerage ?? "",
    agent.agency ?? "",
    agent.full_name ?? "",
    JSON.stringify(agent.raw_payload ?? {}),
    (agent.carriers ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const m = haystack.match(TORCHMARK_BRAND_RE);
  if (m) {
    const hit = m[0].toLowerCase();
    if (hit.includes("ail") || hit.includes("american income"))
      return { excluded: true, reason: "ail", detail: hit };
    if (hit.includes("globe")) return { excluded: true, reason: "globe_life", detail: hit };
    if (hit.includes("liberty")) return { excluded: true, reason: "liberty_national", detail: hit };
    return { excluded: true, reason: "torchmark_family", detail: hit };
  }

  return { excluded: false };
}
