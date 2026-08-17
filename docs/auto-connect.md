# Auto-Connect experiment

LES can scan the currently rendered My Network/Grow results for potential connections with no more than a configurable number of mutual connections. The default maximum is 25, inclusive. For LinkedIn labels such as “Aravind and 57 other mutual connections,” LES compares the displayed number 57 directly with the configured maximum.

When Auto-Connect is enabled, LES injects an Auto-connect queue into Grow. The queue starts with a prompt to scroll down, because only candidates rendered in the open tab can be inspected. As the page renders more results, qualifying candidates are added to the queue automatically. Each row includes the person, headline, company, location, followed state when LinkedIn exposes it, mutual-connection count, an editable connection message prefilled from the control-panel default, an Unqueue action, and a Connect now action. Missing card details are omitted rather than fetched from the profile.

The Auto-connect queued button at the bottom processes the queued rows in the open tab. Requests are serialized and paced, and the batch-size control limits each run. Unqueued candidates remain excluded for the current page session.

The review list excludes cards that do not expose a Connect action or that appear to be connected, pending, invited, or otherwise unavailable. Confirmed requests are sent one at a time with slow randomized pacing. If LinkedIn's dialog or result state cannot be identified, LES stops and leaves the remaining candidates for review.

An optional shared note can be configured in the LES control panel. An empty note uses LinkedIn's standard no-note request flow.

LES does not paginate My Network automatically. Loading more results and rescanning the page adds newly rendered candidates to the review flow.
