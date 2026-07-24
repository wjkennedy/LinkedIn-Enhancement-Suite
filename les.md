Yes. **LinkedIn Enhancement Suite**, or **LES**, is the missing browser layer that makes LinkedIn usable by professionals instead of optimized for engagement theater.

RES made Reddit navigable, configurable, filterable, and personally governable. LES would do the same for LinkedIn by treating the existing site as an unruly data source rather than a finished product.

## The premise

**LinkedIn is valuable data trapped inside an exhausting interface.**

LES restores control to the user:

* Decide what enters the feed
* Reveal what the interface hides
* Suppress repetitive formats and engagement bait
* Add context to people, companies, jobs, and claims
* Turn passive scrolling into deliberate professional work
* Keep notes, classifications, and relationships locally

The product promise:

> **Your network. Your filters. Your professional context.**

## The first essential features

### Post Drafts

LinkedIn's single composer draft becomes a local draft library. LES adds multiple named text drafts, in-place editing, one-click capture and restore, and autosave after a draft is loaded into the composer. Draft content remains local, and LES never publishes on the user's behalf.

The MVP and its data boundaries are documented in [docs/post-drafts.md](docs/post-drafts.md).

### 1. Feed Sanitizer

A rules engine for hiding or collapsing:

* Polls
* “Agree?” posts
* Engagement-bait questions
* AI-generated listicles
* Birthday and work-anniversary announcements
* Suggested posts
* Promoted posts
* Influencer content
* Posts liked by someone you barely know
* Repeated company announcements
* “Comment X and I’ll send you the PDF”
* Self-congratulatory layoff narratives
* Posts containing configurable phrases

Every filter should support:

* Hide
* Collapse
* Dim
* Label
* Move to a separate queue
* Apply only to specific people or relationship levels

### 2. Post Format Labels

LES identifies recurring LinkedIn genres and places a discreet label above them:

* Humblebrag
* Founder mythology
* AI-generated
* Recruitment funnel
* Lead magnet
* Corporate announcement
* Personal brand maintenance
* Manufactured vulnerability
* Conference recap
* Unverified business advice
* Job-search signal
* Genuine technical content

This should be transparent and user-tunable, not an inscrutable central classifier.

### 3. People Tags and Private Notes

Like RES user tags, but professionally useful:

* Met at Team ’26
* Former client
* Strong Jira admin
* Recruiter, contract roles
* Never responds
* Process-mining lead
* Potential partner
* Worked together at eBay
* Posts useful technical material
* Probably automated account

Notes remain local by default and appear beside the person throughout LinkedIn.

A compact relationship card could show:

* Where you met
* Last meaningful interaction
* Shared companies
* Shared groups
* User-defined trust level
* Follow-up date
* Relevant conversation notes

### 4. Actual Chronological Feed

No interpretation. No “Top.” No silent reordering.

Options:

* Newest first
* First-degree connections only
* Selected people only
* Selected companies only
* Saved searches as feeds
* Posts with external links
* Posts with original technical content
* Posts receiving little attention
* Exclude reposts
* Exclude posts older than a chosen threshold

This feature alone might justify installation.

### 5. Connection Intelligence

Replace LinkedIn’s vague relationship model with something operational.

LES could distinguish:

* Actual colleague
* Customer
* Vendor
* Conference contact
* Recruiter
* Applicant
* Friend
* Prospect
* Content-only connection
* Unknown connection
* Imported contact
* Never interacted

It could also flag:

* No interaction in three years
* Repeated unsolicited sales messages
* Connection request with no context
* Person changed roles
* Company entered a target market
* Former contact is now at a strategic account

### 6. Recruiter and Job Controls

LinkedIn’s job experience should become a power-user research interface.

LES could provide:

* Hide staffing agencies
* Hide reposted jobs
* Hide jobs older than a chosen date
* Detect likely ghost jobs
* Normalize compensation
* Estimate actual remote eligibility
* Separate contract, contract-to-hire, and direct employment
* Flag missing compensation
* Flag suspiciously broad job descriptions
* Show repeated posting history
* Show how often a company reposts the same role
* Compare the listing against previous versions
* Extract the real requirements from boilerplate
* Maintain private application status and notes

A useful job card would answer:

> Is this new, real, relevant, appropriately leveled, geographically possible, and worth my time?

### 7. Company Reality Layer

On company pages and mentions, LES could add:

* Recent layoffs
* Hiring trend
* Leadership turnover
* Repeated job reposting
* Acquisitions
* Product discontinuations
* Employee growth or decline
* User notes
* Known client or partner relationships
* Previous conversations
* Blocked or preferred vendors
* Whether the company appears in the user’s CRM, Jira, email, or calendar

External enrichment should be optional. The local, user-authored layer is the core product.

### 8. AI Content Controls

Not merely “detect AI,” which will become unreliable, but identify stylistic and structural signals:

* Excessive parallel sentence structure
* Repeated contrast formulas
* Artificial anecdote-to-lesson arcs
* Generic executive vocabulary
* Unsupported statistics
* Unnecessary headings
* Predictable rhetorical questions
* Emoji-heavy section markers
* “Here are five lessons” formatting
* Suspiciously uniform comments

Possible actions:

* Collapse probable synthetic content
* Show a plain-text reduction
* Extract actual claims
* Highlight unsupported assertions
* Remove rhetorical padding
* Display “information density”
* Identify clusters of nearly identical comments

The killer feature may be:

> **Reduce this post to what it actually says.**

Example:

> “A leader should communicate clearly, support the team, and learn from setbacks.”

Twenty-two paragraphs become one sentence.

## The interface philosophy

LES should not become another dashboard. It should behave like RES:

* Enhance in place
* Add compact controls
* Preserve native navigation
* Keep configuration accessible
* Allow feature-by-feature activation
* Make every automated judgment reversible
* Store sensitive annotations locally
* Export and import the user’s configuration

A small LES control strip might appear on each post:

`Author | Format | Density | Hide rule | Save | Note | Plain text`

## Power-user modules

### LinkedIn Comment Archaeology

* Show the author’s substantive comments first
* Hide congratulations-only comments
* Collapse repeated phrases
* Identify employees, former employees, and domain experts
* Highlight comments from first-degree contacts
* Separate discussion from applause

### Profile Diff

When revisiting a profile:

* New title
* Changed employer
* Revised headline
* Added credential
* Removed role
* Changed location
* New “open to work” state
* New services offered

The user sees only meaningful changes since the last visit.

### Network Lens

Overlay the network according to a chosen purpose:

* Hiring
* Sales
* Partnerships
* Technical expertise
* Local community
* Former colleagues
* Conference follow-up
* Atlassian ecosystem
* Investors
* Suppliers

LinkedIn stops being one undifferentiated graph.

### Professional Reading Queue

Save posts into user-defined queues:

* Read later
* Respond thoughtfully
* Contact author
* Research claim
* Potential article source
* Client relevance
* Product idea
* Competitive intelligence

LES should preserve a clean copy, source metadata, and private annotation.

### Conference Mode

For events such as Team:

* Tag attendees
* Record where someone was met
* Capture topics discussed
* Generate a follow-up queue
* Highlight attendees in the feed afterward
* Expire temporary tags after a chosen period
* Export follow-ups into Jira, a CRM, or a spreadsheet

## The anti-features

LES should explicitly refuse to become:

* An auto-comment bot
* A connection spammer
* A scraping-based lead cannon
* An engagement pod
* A fake-personality generator
* A mass outreach sequencer
* An automatic endorsement tool
* A surveillance product for employers

Its purpose is to improve human judgment, not automate social manipulation.

## MVP

A credible first release needs only five modules:

1. **Feed filters**
2. **Chronological and first-degree feed views**
3. **Private person tags and notes**
4. **Post compression and format classification**
5. **Job-post normalization and duplicate detection**

Technically, this begins as a browser extension with:

* DOM observers for LinkedIn’s dynamically loaded interface
* A local rules engine
* IndexedDB storage
* Import/exportable JSON configuration
* Site-version compatibility checks
* Optional local model or user-supplied API integration
* No central account required for the basic product

## Positioning

Not “LinkedIn, but better.”

More pointedly:

> **LES turns LinkedIn from a casino feed into a professional instrument.**

Or:

> **A user stylesheet for your professional life.**

Or, closest to the RES inheritance:

> **LinkedIn Enhancement Suite gives the network back to the people in it.**

The name is excellent because “LES for LinkedIn” sounds inevitable, familiar, and slightly subversive. The product should feel like something sophisticated LinkedIn users install quietly and then cannot imagine working without.
