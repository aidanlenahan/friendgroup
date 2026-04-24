# Friendgroup Product Requirements Document (PRD)

## Product Summary
Friendgroup is a web app + installable PWA for friend groups to plan events, coordinate conversations, and share media without overwhelming members with irrelevant notifications.

## Problem Statement
Existing tools split use cases across multiple apps:
- Event tools handle scheduling but are weak for conversation context.
- Chat tools handle channels but are weak for attendance, event workflows, and calendar sync.

Users need one place where event planning, event chat, and topic-based notifications work together.

## Goals
- Provide lightweight event planning for friend groups.
- Keep conversations organized by event and by tag/topic channels.
- Reduce notification fatigue through user tag preferences.
- Support media memories tied to events.
- Work as both responsive website and installable PWA.

## Non-Goals (MVP)
- Public social networking feed.
- Advanced moderation tooling for very large communities.
- Native iOS/Android apps in MVP (PWA first).

## Target Users
- Small to medium friend groups (5-200 people).
- Activity-focused subgroups within a larger group (sports, gaming, travel, etc.).
- Organizers who frequently schedule recurring events.

## Core User Stories
- As an organizer, I can create an event with title, details, date/time, tags, and invite list.
- As a member, I can RSVP yes/no and see attendance.
- As a member, I can chat within an event-specific chat.
- As a member, I can subscribe to tags I care about and only receive relevant notifications.
- As a member, I can upload media to an event memory section.
- As a member, I can rate events and mark high-rated ones as legendary.
- As a user, I can choose notification delivery via PWA push and/or email.

## Functional Requirements
### Group and Membership
- Support multiple independent groups per user.
- Group-level membership and permissions.

### Events
- Create/edit/delete events.
- Event fields: title, details, datetime, tags, attendance list.
- Invite specific users to private events.
- RSVP yes/no.
- Optional pin/feature for legendary events.
- Event rating (1-10) with optional legendary threshold.

### Chat
- Event-specific chat room auto-created per event.
- Tag/topic channels at group level.
- Some channels invite-only; some open subscription.
- Pinned messages surfaced in a priority view.

### Tags and Notification Preferences
- Users can follow multiple tags.
- Events and messages can include tags.
- Notifications sent based on match between content tags and user preferences.

### Media
- Event media section supports photos/videos.
- Enforce upload limits (MVP: per-file size + per-event cap).

### Integrations
- Calendar sync/export: iCal/ICS and Google Calendar compatibility.
- Live update behavior for event changes reflected in shared calendar artifacts.

### Notifications
- Web push notifications for PWA users.
- Email notifications as optional channel.
- User-level notification settings by type (chat, event created, event changed, invites).

## Non-Functional Requirements
- Mobile-first responsive UI.
- Installable PWA with service worker.
- Basic accessibility (semantic markup, keyboard nav, contrast).
- Reliable delivery attempts for push/email with retry logging.
- Privacy-first handling of media and invite-only events.

## MVP Scope
- Auth + groups + memberships.
- Event CRUD + RSVP + attendance.
- Event chat + basic group tag channels.
- Tag subscriptions + push/email notifications.
- Event media upload with conservative limits.
- ICS export + Google Calendar compatible links.

## Success Metrics
- Weekly active users per group.
- Event creation to RSVP conversion rate.
- Notification engagement rate (open/click).
- Percentage of users with configured tag preferences.
- Median messages per event chat.

## Risks and Mitigations
- Notification spam risk: strict defaults and per-tag opt-ins.
- Media storage cost: enforce quotas and compression.
- Calendar inconsistency: canonical server event model + update timestamps.
- Permission complexity: role-based access from the start (owner/admin/member).

## Milestones
1. Foundation: auth, group model, event model.
2. Collaboration: RSVP, event chat, tag channels.
3. Engagement: notifications, media, ratings/legendary.
4. Integration polish: ICS/Google calendar and PWA hardening.
