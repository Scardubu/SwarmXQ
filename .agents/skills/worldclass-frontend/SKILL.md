World-Class Frontend Workflow
Objective

Produce a distinctive, accessible, responsive, fast, and implementation-complete user interface grounded in the product’s real content and existing design system.

Required Inputs

Gather from the repository:

product purpose;
target users;
existing design tokens;
current components;
routes and data contracts;
brand assets;
content;
technical constraints;
browser support;
screenshots or references when supplied.

Do not request information already available in the repository.

Workflow
1. Audit the current surface

Inspect:

hierarchy;
typography;
layout;
spacing;
responsiveness;
interaction;
content clarity;
loading and error states;
accessibility;
performance;
duplicated patterns;
visual inconsistencies.

Record the highest-impact issues before editing.

2. Establish the design direction

Write a concise internal design brief:

Visual thesis:
Audience:
Primary user goal:
Content hierarchy:
Signature visual idea:
Interaction thesis:
Typography direction:
Color direction:
Responsive strategy:
Accessibility constraints:
Performance constraints:

Use the existing brand unless a redesign is requested.

3. Build the composition

Lay out the page as a coherent narrative.

Prioritize:

clear first viewport;
one primary action;
readable hierarchy;
meaningful section transitions;
real content;
intentional density;
composition rather than repetitive cards.

Do not stop at a component inventory.

4. Implement the system

Use or extend:

semantic tokens;
reusable primitives;
layout utilities;
typography scale;
spacing scale;
interaction states;
accessible form patterns;
loading and error patterns.

Keep component APIs narrow and composable.

5. Complete all states

Implement and verify:

loading;
empty;
filtered empty;
error;
offline where applicable;
unauthorized;
disabled;
pending;
success;
partial data.
6. Verify accessibility

Check:

semantic structure;
heading order;
keyboard navigation;
focus visibility;
labels and descriptions;
dialog behavior;
announcements;
contrast;
target size;
zoom;
reduced motion.

Correct issues rather than merely documenting them.

7. Verify responsiveness visually

Use Playwright or available browser tooling.

Capture or inspect at:

375×812
768×1024
1024×768
1440×900

Also inspect an intermediate width.

Check:

overflow;
clipped text;
sticky elements;
overlay bounds;
touch usability;
reflow;
navigation;
tables and data density.
8. Verify performance

Check:

client component boundaries;
request waterfalls;
image dimensions and formats;
font loading;
bundle-heavy dependencies;
third-party scripts;
layout shifts;
long interactions;
unnecessary rerenders.

Prefer removing work over masking it with memoization.

9. Run production checks

Run the repository’s:

lint;
typecheck;
frontend tests;
production build;
relevant end-to-end tests.

Inspect the browser console after the production build.

Output Contract

Report:

Design direction:
Major UX improvements:
Files changed:
Accessibility verification:
Responsive verification:
Performance verification:
Commands run:
Remaining risks:

Do not call the result polished or production-ready without visual and runtime evidence.