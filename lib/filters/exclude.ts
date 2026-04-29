// Exclusion filter — keeps captive carriers and the corporate-switchboard
// listings from polluting our outreach pool.
//
// Three layers, applied in order:
//   1) TORCHMARK family (AIL, Globe Life, Liberty National, related). The
//      original ask: avoid these networks entirely.
//   2) Carrier corporate / direct-write listings ("X Insurance Co",
//      "X Insurance Company", standalone carrier brands). These are HQ
//      switchboards or regional offices, not individual agents.
//   3) Captive agents working for a single carrier. The call-analyzer pitch
//      doesn't fit captives — they sell one product, can't shop carriers.
//
// False positives are tolerable: better to skip a borderline match than to
// text a captive agent or carrier switchboard.

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

// Matches when a brokerage/agency name LOOKS LIKE a carrier corporate listing
// rather than an individual agent — usually means we'd be texting an HQ
// switchboard. Covers "X Insurance Co", "X Insurance Co.", "X Insurance Company"
// (with or without "Life" in the middle), plus a handful of standalone
// well-known carrier brands.
const CARRIER_CORPORATE_RE = new RegExp(
  [
    // generic suffix patterns — e.g. "Reliable Life Insurance Co",
    // "Atlanta Life Insurance Company", "Greenville Insurance Co"
    "\\binsurance co\\.?\\s*$",
    "\\binsurance company\\s*$",
    "\\blife insurance company\\b",
    // standalone carrier brand names that are NOT typically individual agents
    "\\bMutual of Omaha\\b",
    "\\bLincoln Financial\\b",
    "\\bPacific Life\\b",
    "\\bTransamerica\\b",
    "\\bJohn Hancock\\b",
    "\\bMass ?Mutual\\b",
    "\\bMassMutual\\b",
    "\\bPrudential\\b",
    "\\bMet ?Life\\b",
    "\\bMetropolitan Life\\b",
    "\\bGuardian Life\\b",
    "\\bAflac\\b",
    "\\bColonial Penn\\b",
    "\\bSILAC\\b",
    "\\bGEICO\\b",
    "\\bProgressive Insurance\\b",
    "\\bErie Insurance\\b",
    "\\bAuto[- ]?Owners\\b",
    "\\bCountry Financial\\b",
    "\\bAmerican Family Insurance\\b",
  ].join("|"),
  "i",
);

// Matches captive-agent listings — a single named person working for one
// carrier. Filtered because they can't shop multiple products, which is what
// novaintel's call analyzer optimizes for.
const CAPTIVE_AGENT_RE = new RegExp(
  [
    "\\bState Farm\\b",
    "\\bAllstate\\b",
    "\\bFarmers Insurance\\b",
    "\\bNationwide Insurance\\b",
    "\\bUSAA\\b",
    "\\bNew York Life\\b",
    "\\bNorthwestern Mutual\\b",
    "\\bPrimerica\\b",
    "\\bHealthMarkets\\b",
    "\\bWFG\\b",
    "\\bWorld Financial Group\\b",
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
    | "carrier_corporate"
    | "captive_agent"
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

  // Layer 1: Torchmark family (the original hard-block).
  const torchmark = haystack.match(TORCHMARK_BRAND_RE);
  if (torchmark) {
    const hit = torchmark[0].toLowerCase();
    if (hit.includes("ail") || hit.includes("american income"))
      return { excluded: true, reason: "ail", detail: hit };
    if (hit.includes("globe")) return { excluded: true, reason: "globe_life", detail: hit };
    if (hit.includes("liberty")) return { excluded: true, reason: "liberty_national", detail: hit };
    return { excluded: true, reason: "torchmark_family", detail: hit };
  }

  // Layer 2: carrier corporate listings — texting these reaches HQ, not an agent.
  // Run on the brokerage/agency string only (haystack would false-positive on
  // raw_payload that mentions a carrier as one of an agent's carriers).
  const brokerageBlob = `${agent.brokerage ?? ""} ${agent.agency ?? ""} ${agent.full_name ?? ""}`;
  const carrierHit = brokerageBlob.match(CARRIER_CORPORATE_RE);
  if (carrierHit) {
    return { excluded: true, reason: "carrier_corporate", detail: carrierHit[0].toLowerCase() };
  }

  // Layer 3: captive agents — wrong fit for the call-analyzer pitch.
  const captiveHit = brokerageBlob.match(CAPTIVE_AGENT_RE);
  if (captiveHit) {
    return { excluded: true, reason: "captive_agent", detail: captiveHit[0].toLowerCase() };
  }

  return { excluded: false };
}
