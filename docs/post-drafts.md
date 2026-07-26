# LES Post Drafts

LinkedIn provides one composer draft. Editing or preserving alternatives requires moving text into another application. LES Post Drafts adds a local Markdown and image workspace directly to the post composer.

## MVP

When LinkedIn's post composer opens, LES adds a Drafts control beside LinkedIn's Emoji, Enhance post, Add media, and More controls. It opens a quick picker with three paths:

- **Save current as draft** captures the current composer text as a separate draft.
- Selecting a named draft copies its publishable text to the clipboard and also loads it into the open composer when LinkedIn's editor is available.
- **Manage drafts** opens the full local draft manager.

The manager supports creating, renaming, editing, previewing, deleting, and loading drafts. Its small JavaScript editor provides Markdown shortcuts for emphasis, links, and lists, plus local image storage and a sanitized preview. Loading a draft converts Markdown to sanitized rich text for LinkedIn's composer while retaining a readable plain-text fallback. Subsequent composer edits autosave to the loaded LES draft. Drafts are ordered by most recently updated and capped at 50.

Up to nine PNG, JPEG, GIF, or WebP images can be stored with a draft. When a draft is loaded, LES makes a best-effort handoff of those files to LinkedIn's existing media drop zone. If LinkedIn changes that private UI contract, the text still loads and LES tells the user to add the saved media with LinkedIn's Add media control.

## Data and publishing boundaries

Drafts and image data are stored in `chrome.storage.local` under `LES.postDrafts`. LES does not transmit draft content, publish posts, or press LinkedIn's Post button. The user remains responsible for reviewing and publishing every post.

LinkedIn mentions, polls, documents, articles, audience settings, and scheduling state are private application state and are not promised to survive capture or restore. Capturing an existing LinkedIn post captures its text, not its media.

## Publishing architecture

The MVP uses the open LinkedIn composer as the publishing boundary:

1. LES owns the local Markdown source and image library.
2. Selecting a draft converts its Markdown to sanitized HTML and copies both rich-text and plain-text clipboard representations.
3. **Use in post** and the quick picker insert the rich-text representation through LinkedIn's normal editor input path and attempt to attach image files through LinkedIn's media drop zone.
4. The user reviews the resulting native composer and explicitly publishes.

This has a materially smaller security and maintenance footprint than direct API publishing: no LES service, OAuth callback, access-token storage, organization authorization, media-upload lifecycle, or API-version migration is required.

An optional API publisher can be added later as a separate adapter. It must use LinkedIn's versioned Posts and Images APIs, obtain the appropriate member or organization permissions, upload media before creating a post, expose account/audience selection, and preserve the explicit final confirmation.

## Acceptance criteria

1. Opening a LinkedIn post composer reveals the LES Drafts bar without obscuring native controls.
2. Save copy creates an independent local draft from non-empty composer text.
3. Users can create and edit Markdown drafts and see a sanitized preview without copying text to another application.
4. Users can add, preview, and remove locally stored images.
5. Loading from the quick picker copies the converted draft even if LinkedIn's editor cannot be detected.
6. Loading from either the quick picker or manager targets the active visible composer when available.
7. Use in post converts Markdown, replaces the current composer text, and triggers LinkedIn's normal editor update path.
8. LES attempts to attach stored images but degrades to a clear manual-media instruction.
9. Edits made after loading an LES draft are autosaved locally.
10. Deletion requires confirmation.
11. The manager works in LES Night Mode and at narrow viewport widths.
12. LES never publishes or schedules content on the user's behalf.

## Follow-on work

- Version history and restore points.
- Search, tags, campaign/topic grouping, and pinning.
- Export/import in a portable JSON or Markdown format.
- Character limits and previews for different post types.
- Duplicate detection and stale-draft reminders.
- Optional sync chosen and controlled by the user.
- Drag-and-drop reordering and image alt-text editing.
- Optional direct publisher adapter using LinkedIn's approved APIs and explicit user confirmation.
