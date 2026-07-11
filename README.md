# LinkedIn Enhancement Suite

LinkedIn Enhancement Suite, or LES, is a browser extension that makes LinkedIn more configurable, filterable, and useful for professional work.

The product direction is captured in [les.md](/les.md).

## Current Milestone

This repository began as a RES codebase fork. The active runtime is being narrowed to LinkedIn-specific modules before older Reddit modules are ported, removed, or replaced.

Initial implementation focus:

1. Retarget the extension shell to LinkedIn.
2. Add a LinkedIn DOM adapter.
3. Ship an initial feed sanitizer with reversible hide, collapse, dim, and label actions.

## Building and contributing

Trying LES

  LES is currently an early development build. It is not ready for daily use yet, but you can try the first working slice: the LinkedIn-targeted browser extension and the initial Feed Sanitizer.

  What LES does right now

  LES loads on LinkedIn and can identify feed posts that look like:

  - promoted posts
  - suggested posts
  - polls
  - common engagement-bait posts
  - posts matching configured phrase rules

  When LES matches a post, it can label, dim, collapse, or hide it depending on the configured action.

  Install the development build

  1. Clone or open the LES repository.
  2. Install dependencies:

  yarn install --frozen-lockfile

  3. Build the extension:

  npm run once

  4. Open Chrome and go to:

  chrome://extensions

  5. Enable Developer mode.
  6. Click Load unpacked.
  7. Select:

  dist/chrome

  8. Open LinkedIn in a normal browser tab:

  https://www.linkedin.com/feed/

  What to test

  On the LinkedIn feed, look for whether LES:

  - loads without breaking LinkedIn
  - adds small LES: labels to matching posts
  - collapses matching posts by default
  - continues working as you scroll and LinkedIn loads more posts
  - leaves normal feed navigation usable

  Things worth reporting

  Please report:

  - posts LES should have matched but did not
  - posts LES matched incorrectly
  - LinkedIn UI areas that look broken after LES loads
  - labels that appear in strange places
  - scrolling or feed loading problems
  - console errors, if you are comfortable checking DevTools

  Current limitations

  This is an early build. People tags, private notes, job controls, post compression, and full settings polish are not implemented yet. The useful feedback right now is mainly about whether LES can safely run on
  LinkedIn and whether the first feed-sanitizer behavior feels directionally right.
