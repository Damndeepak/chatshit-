# Chatshit

A soft, mobile-first chat prototype with Instagram-style Notes, music links, a public community room, and installable PWA support.

## Run it

Open `index.html` for the local preview. For service-worker and install behavior, serve the folder over HTTPS (GitHub Pages works) or on `localhost`.

## Features

- Responsive inbox for one shared community room, profile, stories, search, reactions, and dark mode.
- Image sharing in the room and photo or text stories, with 5 MB JPEG, PNG, or WebP uploads.
- Notes that expire after 24 hours, with optional YouTube Music / Metrolist / Spotify links.
- Optional Spotify sign-in that shows your own live track in Notes on this device.
- A live People directory listing every Chatshit profile in the shared Supabase project.
- One `Everyone` room for messages shared between all visitors when the Supabase backend is configured.
- Progressive Web App manifest, offline app shell, home-screen icon, and an install button.
- No demo people or sample conversations are seeded. Without the shared backend, posting is disabled and the site shows a setup message.

## Turn on shared chat and Notes

The repository is static; it does not contain a server or database. Supabase supplies anonymous sessions, public profiles/messages/notes tables, and realtime updates.

1. Create a Supabase project.
2. In **Authentication → Sign-in / Providers**, enable anonymous sign-ins.
3. Open **SQL Editor** and run [`backend/supabase.sql`](backend/supabase.sql). If Supabase was already set up, run the updated script again to add image and story support and backfill the profiles table.
4. Copy the project URL and its **publishable** key (or legacy anon key) into `js/cloud-config.js`.
5. Deploy the repo to an HTTPS host. The first visit creates an anonymous session, registers its display name in the directory, and joins the one shared room.

The current sign-in is anonymous and tied to that browser; this repo does not yet have email/password registration or cross-device accounts. **People** lists every row in `profiles`, including the current user. Only display names and account creation dates are exposed; emails are never queried or shown. RLS lets signed-in members read the directory and update only their own profile. The app currently has one public room; it does not provide private one-to-one chats.

The browser key is public by design; row-level security in the SQL file controls access. Never put a `service_role` or secret key in `cloud-config.js`. The directory, room, Notes, and active Stories are visible to signed-in visitors. Stories expire after 24 hours. Images live in a private Storage bucket and are displayed with signed links that expire after seven days; anyone you forward a signed link to can open it before expiry. Expired Story rows and their image files are cleaned up when a member next opens the app. Messages are limited to 1,000 characters and 20 per user per minute; Notes are limited to 60 characters. Add CAPTCHA and moderation before inviting a large public audience.

Without the project URL/key and SQL setup, the UI stays in preview mode and will not claim that messages reached anyone else.

## Connect Spotify

1. Create a Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and add the exact HTTPS site URL (including any GitHub Pages project path) as a Redirect URI. For this repo on GitHub Pages, use `https://damndeepak.github.io/chatshit-/` unless you deploy it on a custom domain.
2. Copy its Client ID into `spotifyClientId` in `js/cloud-config.js`. Do not add a Client Secret to the website.
3. Deploy or serve Chatshit on HTTPS, open **Notes → Add yours → Connect**, and approve the `user-read-currently-playing` permission.

The current track is polled about every 30 seconds and shown only in your own browser. Tokens are kept in this browser and can be removed with **Disconnect**. To share a song link with the room, tap **Add current song link**, write a Note, and share it; the link opens Spotify.

Spotify's current [Developer Policy](https://developer.spotify.com/policy) disallows transferring Spotify data to another service, so Chatshit does not send API-read playback metadata to the shared Notes backend. Development Mode also currently requires the app owner to have Spotify Premium and allows up to five authorized Spotify users; see [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

The app's [privacy notice](privacy.html) describes its local token storage and shared Notes behavior. Add any deployment-specific contact or privacy details before inviting users.

## Add a song from Metrolist

In Metrolist, copy or share the song’s YouTube Music link, then paste it into the optional song field when writing a Note. The link is saved with the Note and opens from the music chip. On Android, the phone may route a YouTube Music link to Metrolist if Metrolist is installed and set to handle it. Chatshit does not log in to Metrolist, read its library, or control its player.

## Install on a phone

Deploy to HTTPS first. On Android, open the site in Chrome and tap **Install** in the inbox footer (or choose **Install app / Add to Home screen** in the browser menu). On iPhone, open in Safari, tap **Share**, then **Add to Home Screen**. This installs the website as a PWA; it is not a Play Store APK.
