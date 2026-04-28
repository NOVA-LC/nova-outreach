// Quick sanity tests for the AIL/Globe filter. Run with: npx tsx lib/filters/__tests__.ts
import { classify } from "./exclude";

const cases: { name: string; input: any; expectExcluded: boolean }[] = [
  {
    name: "AIL email domain",
    input: { email: "joe@ailife.com" },
    expectExcluded: true,
  },
  {
    name: "Globe Life domain",
    input: { email: "j@globelifeinsurance.com" },
    expectExcluded: true,
  },
  {
    name: "AIL in brokerage name",
    input: { email: "joe@gmail.com", brokerage: "American Income Life - Atlanta" },
    expectExcluded: true,
  },
  {
    name: "AIL acronym in agency",
    input: { email: "j@gmail.com", agency: "AIL Region 23" },
    expectExcluded: true,
  },
  {
    name: "Liberty National in bio payload",
    input: { email: "x@y.com", raw_payload: { bio: "Liberty National agent for 5 years" } },
    expectExcluded: true,
  },
  {
    name: "Independent agent on Gmail with no carriers",
    input: { email: "betty@gmail.com", brokerage: "Betty Insurance LLC" },
    expectExcluded: false,
  },
  {
    name: "Mutual of Omaha agent (NOT excluded)",
    input: { email: "rick@gmail.com", brokerage: "Mutual of Omaha", carriers: ["Mutual of Omaha"] },
    expectExcluded: false,
  },
  {
    name: "Missing email -> excluded as missing_email",
    input: { email: null },
    expectExcluded: true,
  },
  {
    name: "Word 'fail' should not match AIL",
    input: { email: "fail@example.com", brokerage: "Failsafe Insurance" },
    expectExcluded: false,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = classify(c.input);
  const ok = r.excluded === c.expectExcluded;
  if (ok) {
    pass++;
    console.log(`PASS  ${c.name}${r.reason ? ` (${r.reason})` : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${c.name}  got=${JSON.stringify(r)} expected.excluded=${c.expectExcluded}`);
  }
}
console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
