// Story-driven cold email variants. Each pairs a specific moment with a soft CTA.
// We rotate variants stably per send_id so retries don't change which story landed.

export interface Variant {
  subject: string;
  // body is a function so we can interpolate first name + tracking link.
  text: (args: { firstName: string; trackUrl: string }) => string;
  html: (args: { firstName: string; trackUrl: string }) => string;
}

const opener = (firstName: string) => firstName?.trim() ? `Hey ${firstName},` : "Hey,";

// V1 — the cow story
const v1: Variant = {
  subject: "she lost a $40k policy in 3 minutes",
  text: ({ firstName, trackUrl }) => `${opener(firstName)}

Watched an agent yesterday lose a $40k AP policy. Her prospect mentioned his dad just died. She pivoted to a 3-minute story about her grandfather's farm. A cow story. While a grown man was crying.

He didn't buy. She didn't even know that was the moment she lost him.

I built a thing that listens to your last call and tells you which moments cost you the policy. Free, no signup, 60 seconds.

${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${opener(firstName)}</p>
<p>Watched an agent yesterday lose a $40k AP policy. Her prospect mentioned his dad just died. She pivoted to a 3-minute story about her grandfather's farm. A cow story. While a grown man was crying.</p>
<p>He didn't buy. She didn't even know that was the moment she lost him.</p>
<p>I built a thing that listens to your last call and tells you which moments cost you the policy. Free, no signup, 60 seconds.</p>
<p><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

// V2 — the "wasn't enough" moment
const v2: Variant = {
  subject: `"wasn't enough" — and they walked`,
  text: ({ firstName, trackUrl }) => `${opener(firstName)}

The prospect said his dad had life insurance "but it wasn't enough." Most agents nod and pivot to the pitch.

The closers ask what "enough" actually meant. Who paid the funeral. What got cut from the household. What's still hurting today. That's the moment the policy gets sold — and most agents skip right past it.

I built a tool that flags those moments in your last call. Upload one, free.

${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${opener(firstName)}</p>
<p>The prospect said his dad had life insurance "but it wasn't enough." Most agents nod and pivot to the pitch.</p>
<p>The closers ask what "enough" actually meant. Who paid the funeral. What got cut from the household. What's still hurting today. That's the moment the policy gets sold — and most agents skip right past it.</p>
<p>I built a tool that flags those moments in your last call. Upload one, free.</p>
<p><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

// V3 — the silence
const v3: Variant = {
  subject: "4 seconds of silence killed her close",
  text: ({ firstName, trackUrl }) => `${opener(firstName)}

Watched a closing call yesterday. Prospect said "let me think about it." Agent panicked, started re-pitching benefits. Lost the policy in 90 seconds.

If she'd shut up for 4 seconds, the prospect would've kept talking. They always do. The objection is rarely the objection — it's the lead-in to the real one.

I built a thing that grades these moments. Upload your last call, see what you missed.

${trackUrl}

— Tyler`,
  html: ({ firstName, trackUrl }) => `<p>${opener(firstName)}</p>
<p>Watched a closing call yesterday. Prospect said "let me think about it." Agent panicked, started re-pitching benefits. Lost the policy in 90 seconds.</p>
<p>If she'd shut up for 4 seconds, the prospect would've kept talking. They always do. The objection is rarely the objection — it's the lead-in to the real one.</p>
<p>I built a thing that grades these moments. Upload your last call, see what you missed.</p>
<p><a href="${trackUrl}" style="color:#1d4ed8;">${trackUrl}</a></p>
<p>— Tyler</p>`,
};

export const VARIANTS: Variant[] = [v1, v2, v3];

// Stable pick from send_id so retries don't change.
export function pickVariant(seed: string | number): Variant {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return VARIANTS[Math.abs(h) % VARIANTS.length];
}
