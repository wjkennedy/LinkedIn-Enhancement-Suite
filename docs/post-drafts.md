# LES Post Drafts

LinkedIn provides one composer draft. Editing or preserving alternatives requires moving text into another application. LES Post Drafts adds a local text-draft library directly to the post composer.

## MVP

When LinkedIn's post composer opens, LES adds a Drafts control beside LinkedIn's Emoji, Enhance post, Add media, and More controls. It opens a quick picker with three paths:

- **Save current as draft** captures the current composer text as a separate draft.
- Selecting a named draft loads it directly into the open composer.
- **Manage drafts** opens the full local draft manager.

The manager supports creating, renaming, editing, deleting, and loading drafts. Loading a draft replaces the text in the open LinkedIn composer. Subsequent composer edits autosave to the loaded LES draft. Drafts are ordered by most recently updated and capped at 50.

## Data and publishing boundaries

Drafts are stored in `chrome.storage.local` under `LES.postDrafts`. LES does not transmit draft content, publish posts, or press LinkedIn's Post button. The user remains responsible for reviewing and publishing every post.

The MVP stores plain text only. LinkedIn mentions, media, polls, documents, articles, audience settings, and scheduling state are private application state and are not promised to survive capture or restore.

## Acceptance criteria

1. Opening a LinkedIn post composer reveals the LES Drafts bar without obscuring native controls.
2. Save copy creates an independent local draft from non-empty composer text.
3. Users can create and edit drafts without copying text to another application.
4. Use in post replaces the current composer text and triggers LinkedIn's normal editor update path.
5. Edits made after loading an LES draft are autosaved locally.
6. Deletion requires confirmation.
7. The manager works in LES Night Mode and at narrow viewport widths.
8. LES never publishes or schedules content on the user's behalf.

## Follow-on work

- Version history and restore points.
- Search, tags, campaign/topic grouping, and pinning.
- Export/import in a portable JSON or Markdown format.
- Character limits and previews for different post types.
- Duplicate detection and stale-draft reminders.
- Optional sync chosen and controlled by the user.
- Best-effort attachment manifests without claiming that LinkedIn-private state can be reconstructed.
