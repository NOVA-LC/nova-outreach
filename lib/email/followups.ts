// Follow-up email templates. Two steps by default — day +4 and day +11.
//
// Stylistic rules carried over from variants.ts:
//   - lowercased, conversational subject lines
//   - body opens with a story / observation, not "just following up"
//   - one soft CTA, no pressure
//   - never reference the prior email's subject directly (recipient may not
//     have opened it)
//
// Step indexing: 0 = initial send (handled by send-batch.ts).
// 1 = first follow-up. 2 = second follow-up. Beyond max_followup_steps the
// runner won't queue more.

export interface FollowupVariant {
  subject: string;
  text: (args: { firstName: string; trackUrl: string }) => string;
  html: (args: { firstName: string; trackUrl: string }) => string;
}

const STEP_1: FollowupVariant = {
  subject: "the part of the call you don't remember",
  text: ({ firstName, trackUrl }) => {
    const hi = firstName ? `${firstName},` : "hey,";
    return `${hi}

most agents replay their calls in their head and remember the part where the prospect said no.

what they forget is the 90 seconds before that — the moment the prospect leaned in, then leaned back. that's where the deal actually gets lost.

i built a free tool that pulls the transcript and shows you exactly when the energy shifted. takes about a minute to upload a call, two more to read what it found.

${trackUrl}

if it's not useful, ignore — no follow-up.`;
  },
  html: ({ firstName, trackUrl }) => {
    const hi = firstName ? `${firstName},` : "hey,";
    return `<p>${hi}</p>
<p>most agents replay their calls in their head and remember the part where the prospect said no.</p>
<p>what they forget is the 90 seconds before that — the moment the prospect leaned in, then leaned back. that's where the deal actually gets lost.</p>
<p>i built a free tool that pulls the transcript and shows you exactly when the energy shifted. takes about a minute to upload a call, two more to read what it found.</p>
<p><a href="${trackUrl}" style="color:#1a4d8f;">${trackUrl}</a></p>
<p style="color:#666;font-size:14px;">if it's not useful, ignore — no follow-up.</p>`;
  },
};

const STEP_2: FollowupVariant = {
  subject: "last note from me",
  text: ({ firstName, trackUrl }) => {
    const hi = firstName ? `${firstName},` : "hey,";
    return `${hi}

won't keep emailing.

one number stuck with me from the agents who've used the tool: 7 out of 10 found a specific phrase they were saying that was killing the close. one specific phrase. usually said in the first 4 minutes.

if you ever want to find yours: ${trackUrl}

that's it. good selling out there.`;
  },
  html: ({ firstName, trackUrl }) => {
    const hi = firstName ? `${firstName},` : "hey,";
    return `<p>${hi}</p>
<p>won't keep emailing.</p>
<p>one number stuck with me from the agents who've used the tool: <strong>7 out of 10</strong> found a specific phrase they were saying that was killing the close. one specific phrase. usually said in the first 4 minutes.</p>
<p>if you ever want to find yours: <a href="${trackUrl}" style="color:#1a4d8f;">${trackUrl}</a></p>
<p style="color:#666;">that's it. good selling out there.</p>`;
  },
};

const STEPS: FollowupVariant[] = [STEP_1, STEP_2];

/**
 * Returns the followup variant for a given step (1-indexed: 1 = first followup).
 * Returns null if the step is beyond what we have templates for.
 */
export function pickFollowup(step: number): FollowupVariant | null {
  const idx = step - 1;
  if (idx < 0 || idx >= STEPS.length) return null;
  return STEPS[idx];
}

export function maxFollowupSteps(): number {
  return STEPS.length;
}
