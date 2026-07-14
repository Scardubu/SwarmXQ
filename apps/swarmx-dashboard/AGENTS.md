World-Class Frontend and Product Design Instructions
Frontend Mission

Build interfaces that are:

clear before clever;
distinctive without being decorative;
accessible by default;
fast on realistic devices and networks;
responsive across narrow and wide viewports;
coherent with the product’s domain and brand;
resilient across loading, empty, error, offline, and permission states.

Do not produce generic “AI-generated dashboard” design.

Design Discovery

Before changing a substantial interface, inspect:

existing design tokens;
typography;
spacing;
grids;
navigation;
responsive breakpoints;
interaction patterns;
reusable components;
accessibility conventions;
real content;
screenshots or reference assets;
the surrounding page composition.

Preserve a coherent existing design system unless redesign is explicitly requested.

Visual Thesis

For new pages or major redesigns, define before implementation:

Visual thesis:
  One sentence describing the visual character.

Content hierarchy:
  The sequence of ideas the user should understand.

Interaction thesis:
  How movement, feedback, and transitions support comprehension.

Signature element:
  The one memorable device that belongs to this product.

Constraints:
  Accessibility, performance, device, network, and brand limitations.

Do not begin by choosing a component library layout.

Composition Before Components

Design the page as one composition.

Prefer:

meaningful hierarchy;
intentional whitespace;
strong alignment;
asymmetry when useful;
clear focal points;
varied but disciplined rhythm;
full-width or full-bleed moments where appropriate;
section transitions driven by narrative.

Avoid by default:

card grids for every section;
excessive rounded rectangles;
nested cards;
“pill” labels everywhere;
decorative gradients without purpose;
arbitrary glass effects;
oversized empty hero sections;
identical three-column feature blocks;
excessive centered text;
generic stock illustrations;
animation on every element.

Each section should have one primary job.

Typography

Typography must communicate product character and hierarchy.

Use:

a restrained type scale;
readable line lengths;
deliberate weight contrast;
stable vertical rhythm;
tabular numerals where data comparison benefits;
fluid sizing where appropriate.

Normally use no more than two type families.

Do not choose novelty fonts that harm readability.

Reserve monospace typography for code, identifiers, measurements, or purposeful technical accents.

Color and Tokens

Represent visual decisions as semantic tokens:

background
surface
surfaceElevated
textPrimary
textSecondary
border
accent
accentContrast
success
warning
danger
focus

Do not scatter raw color values through components.

Use one primary accent direction unless the brand requires more.

Verify contrast in:

default;
hover;
focus;
disabled;
selected;
error;
dark mode where supported.

Do not encode meaning through color alone.

Responsive Design

Design and verify at minimum:

320–375 px
768 px
1024 px
1440 px

Also inspect intermediate widths.

Requirements:

no accidental horizontal scrolling;
touch targets remain usable;
text does not clip;
tables have intentional small-screen behavior;
navigation remains operable;
overlays fit the viewport;
sticky elements do not obscure content;
forms remain understandable;
content priority is preserved rather than merely stacked.

Prefer intrinsic layout, grid, flexbox, container queries, and content-driven breakpoints over device-specific hacks.

Accessibility

Target WCAG 2.2 AA.

Use semantic HTML before ARIA.

Every interaction must support:

keyboard operation;
visible focus;
sensible focus order;
screen-reader naming;
error identification;
reduced-motion preferences;
zoom and text resizing;
sufficient contrast;
appropriate target size.

Requirements:

one logical page heading;
correctly nested headings;
labels for every form field;
instructions not dependent on placeholders;
errors associated with fields;
status changes announced when needed;
dialogs trap and restore focus correctly;
escape closes dismissible overlays;
icon-only controls have accessible names;
images have purposeful alt text or empty alt when decorative.

Do not add ARIA roles that duplicate or contradict native semantics.

Interaction and Motion

Motion must clarify:

state change;
spatial relationship;
navigation;
progress;
causality;
success or failure.

Use restrained duration and easing.

Avoid:

blocking entrance sequences;
parallax that harms readability;
animation-driven layout shift;
continuously moving decorative elements;
motion essential to understanding.

Respect prefers-reduced-motion.

React and Next.js

When using React/Next.js:

use Server Components by default;
add "use client" only at the narrowest interactive boundary;
keep server-only modules out of client bundles;
fetch independent data in parallel;
avoid request waterfalls;
use Suspense and streaming deliberately;
colocate loading and error boundaries with ownership;
avoid mirroring props into state;
avoid effects for derivable values;
clean up subscriptions and asynchronous work;
avoid premature memoization;
use stable keys based on identity;
preserve URL state for shareable navigation and filters;
use framework image and font facilities where appropriate;
validate metadata, canonical URLs, and social previews.

Do not move a whole page to the client because one small control is interactive.

State Design

Every data-backed surface must deliberately handle:

initial loading
incremental loading
empty result
filtered empty result
partial data
recoverable error
terminal error
offline state
unauthorized state
forbidden state
stale data
success

Skeletons should resemble final geometry and must not create large layout shifts.

Errors should say:

what failed;
what the user can do;
whether data was preserved;
how to retry.
Forms

Forms require:

correct input type;
visible label;
description where needed;
server-side validation;
safe client-side assistance;
disabled and pending behavior;
duplicate-submit protection;
field and form-level errors;
preserved user input after recoverable failure;
success confirmation.

Do not disable submission without explaining why.

Performance Budgets

Target at the 75th percentile:

LCP <= 2.5 seconds
INP <= 200 milliseconds
CLS <= 0.1

Also control:

JavaScript transferred;
client component count;
hydration cost;
image bytes;
font files;
third-party scripts;
long main-thread tasks;
render frequency.

Do not fix performance solely with memoization. Remove unnecessary client work first.

Frontend Verification

Use browser automation to inspect rendered behavior.

Verify:

desktop and mobile screenshots;
keyboard navigation;
focus visibility;
loading and error states;
console errors;
network failures;
broken assets;
overflow;
page metadata;
reduced motion;
production build.

Test user-visible behavior rather than internal component implementation.

Use resilient locators based on roles, labels, text, and explicit testing contracts.