// Value-first cold email variants — each leads with a real insight (the "aha"),
// shifts the reader's perspective on something they think they already know,
// then offers an optional next step. The email itself is the value, even if
// they never click. Inspired by Hormozi giveaway frame + NEPQ status restraint
// + DeBrand opinionated voice.

export interface Variant {
  subject: string;
  text: (args: { firstName: string; trackUrl: string }) => string;
  html: (args: { firstName: string; trackUrl: string }) => string;
}

const greeting = (firstName: string) => firstName?.trim() ? `Hey ${firstName},` : "Hey,";

// V1 — the price reveal frame
const v1: Variant = {
  subject: "when most agents lose the close",
  text: ({ firstName, trackUrl }) => `${greeting(firstName)}

Most life agents lose the policy the moment they reveal premium. Not because the price is wrong — because they reveal it before the prospect has named the cost of NOT having coverage.

Once price hits the table first, the entire frame is "is this worth $X."
When loss hits the table first, the frame is "is $X worth avoiding that."

Same number. Different sale.

If you ever want to see exactly when in your last call you flipped which frame was active: ${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${greeting(firstName)}</p>
<p>Most life agents lose the policy the moment they reveal premium. Not because the price is wrong — because they reveal it before the prospect has named the cost of NOT having coverage.</p>
<p>Once price hits the table first, the entire frame is "is this worth $X."<br>When loss hits the table first, the frame is "is $X worth avoiding that."</p>
<p>Same number. Different sale.</p>
<p>If you ever want to see exactly when in your last call you flipped which frame was active:<br><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

// V2 — the fake objection
const v2: Variant = {
  subject: `"I want to think about it"`,
  text: ({ firstName, trackUrl }) => `${greeting(firstName)}

When a prospect says "let me think about it," they're not stalling. They have a specific objection they don't want to say out loud — usually price, sometimes spouse, sometimes you.

Re-pitching benefits at that moment is the response that kills it. The move that works is one question, said calm, not desperate:

"What specifically are you wanting to think through?"

Nine times out of ten, they tell you the real objection. Then you can actually handle it instead of fighting a ghost.

Curious whether you've been doing this on your last few calls? ${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${greeting(firstName)}</p>
<p>When a prospect says "let me think about it," they're not stalling. They have a specific objection they don't want to say out loud — usually price, sometimes spouse, sometimes you.</p>
<p>Re-pitching benefits at that moment is the response that kills it. The move that works is one question, said calm, not desperate:</p>
<p style="margin-left:20px;color:#444;"><em>"What specifically are you wanting to think through?"</em></p>
<p>Nine times out of ten, they tell you the real objection. Then you can actually handle it instead of fighting a ghost.</p>
<p>Curious whether you've been doing this on your last few calls?<br><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

// V3 — where most agents stop asking
const v3: Variant = {
  subject: "where most agents stop asking",
  text: ({ firstName, trackUrl }) => `${greeting(firstName)}

The agents I see closing 4-out-of-10 ask about income, debts, kids, then pitch.

The agents closing 7-out-of-10 ask one more question first: "if something happened to you tomorrow, who's making sure your mom's mortgage gets paid?"

That question doesn't qualify anything. It paints a picture. The picture is what gets the policy bought, not the numbers.

Most agents skip it because it feels intrusive. The prospects who said yes to that question are also the prospects who said yes to the policy.

Want to see if you skipped it on your last one? ${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${greeting(firstName)}</p>
<p>The agents I see closing 4-out-of-10 ask about income, debts, kids, then pitch.</p>
<p>The agents closing 7-out-of-10 ask one more question first: <em>"if something happened to you tomorrow, who's making sure your mom's mortgage gets paid?"</em></p>
<p>That question doesn't qualify anything. It paints a picture. The picture is what gets the policy bought, not the numbers.</p>
<p>Most agents skip it because it feels intrusive. The prospects who said yes to that question are also the prospects who said yes to the policy.</p>
<p>Want to see if you skipped it on your last one?<br><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

// V4 — the "they already have coverage" lapse question
const v4: Variant = {
  subject: `"I already have life insurance"`,
  text: ({ firstName, trackUrl }) => `${greeting(firstName)}

When a prospect tells you they're already covered, most agents either pivot to a replacement pitch (risky — "twisting" is illegal in most states without disclosure) or walk away.

The agents who keep the conversation alive ask one thing:

"What happens to it if you miss 3 premiums?"

Most term policies lapse silently. Half the prospects telling you "I'm covered" have no idea their policy might lapse before they actually need it. That single question reopens the door — no twisting, no replacement script, just a real concern they hadn't considered.

Curious if it would've worked on your last "no thanks"? ${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${greeting(firstName)}</p>
<p>When a prospect tells you they're already covered, most agents either pivot to a replacement pitch (risky — "twisting" is illegal in most states without disclosure) or walk away.</p>
<p>The agents who keep the conversation alive ask one thing:</p>
<p style="margin-left:20px;color:#444;"><em>"What happens to it if you miss 3 premiums?"</em></p>
<p>Most term policies lapse silently. Half the prospects telling you "I'm covered" have no idea their policy might lapse before they actually need it. That single question reopens the door — no twisting, no replacement script, just a real concern they hadn't considered.</p>
<p>Curious if it would've worked on your last "no thanks"?<br><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

// V5 — the email-kill close
const v5: Variant = {
  subject: "the worst sentence in life sales",
  text: ({ firstName, trackUrl }) => `${greeting(firstName)}

"Sure, I'll send you some info to look over."

That sentence is where 90% of policies die. The prospect feels relieved. You feel polite. Neither of you is going to talk again.

The agents who close more give a 2-option choice instead:

"Easier if I walk you through it real quick now, or would you rather a 15-min call tomorrow morning?"

Same outcome — you stay engaged. They feel in control. The illusion of choice is the close.

Want to see the moments your last call should've forced a choice instead of an exit? ${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${greeting(firstName)}</p>
<p><em>"Sure, I'll send you some info to look over."</em></p>
<p>That sentence is where 90% of policies die. The prospect feels relieved. You feel polite. Neither of you is going to talk again.</p>
<p>The agents who close more give a 2-option choice instead:</p>
<p style="margin-left:20px;color:#444;"><em>"Easier if I walk you through it real quick now, or would you rather a 15-min call tomorrow morning?"</em></p>
<p>Same outcome — you stay engaged. They feel in control. The illusion of choice is the close.</p>
<p>Want to see the moments your last call should've forced a choice instead of an exit?<br><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

export const VARIANTS: Variant[] = [v1, v2, v3, v4, v5];

export function pickVariant(seed: string | number): Variant {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return VARIANTS[Math.abs(h) % VARIANTS.length];
}
