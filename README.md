# Music Catalog

A tiny app for cataloging a record/music collection. The home page is a
Spotify-style grid of your collection with a live search; a separate **Add**
page handles all data entry (barcode scanning and add-by-name). Everything is
saved to a local CSV, with album covers cached locally so it works offline after
the first load.

![Spotify-style grid of album covers](#)

## Features

Home page (`/`) — browse your collection:
- **Search your collection** — filter the grid live by title, artist, or barcode.
- **Local cover cache** and **tracklists** (see below).
- **Die Roll**: pick a random album to play next.

Add page (`/add.html`) — everything that adds to the collection:
- **Scan barcodes** (USB scanner or phone camera keyboard); each scan is looked
  up online and **auto-saved** to `VinylScans.csv` — no export step.
- **Add by name**: for records whose barcode won't scan, search MusicBrainz by
  artist + album and pick the right pressing (vinyl-only filter, cover art,
  year, and barcode when known).
- **Hand-editable CSV**: alternatively, add albums by editing the CSV directly
  (leave the `Barcode` column empty) and clicking **Reload** on the home page.
- **Local cover cache**: album art is downloaded once into `covers/` and served
  from disk thereafter.
- **Tracklists**: click an album to see its tracklist, fetched from
  [MusicBrainz](https://musicbrainz.org/) (no API key needed) and cached in
  `trackcache/`.
- **Die Roll**: pick a random album to play next.
- **LAN access**: reachable from your phone on the same Wi-Fi.

## Requirements

- [Node.js](https://nodejs.org/) 16 or newer (no npm packages required).
- A free [RapidAPI](https://rapidapi.com/) account subscribed to the
  **Barcodes Lookup** API (`barcodes1.p.rapidapi.com`), for the lookup key.

## Setup

1. Get a RapidAPI key for the Barcodes Lookup API.
2. Provide the key. Either put it in a local `.env` file (recommended):

   ```sh
   cp .env.example .env
   # then edit .env and set RAPID_API_KEY=your_key_here
   node server.js
   ```

   ...or pass it inline: `RAPID_API_KEY=your_key_here node server.js`.

   The `.env` file is git-ignored, so your key never gets committed.

3. Open **http://localhost:8000/** in your browser.

The server prints a LAN URL too (e.g. `http://192.168.1.50:8000/`) so you can
scan from a phone on the same network.

## Usage

- **Browse/search** on the home page: type in the search box to filter your
  collection; click any album to see its cover and tracklist; **Die Roll** picks
  one at random.
- **Add albums** on the **Add** page (button in the top bar, or `/add.html`):
  - *Scan a barcode* — the album is looked up and saved to `VinylScans.csv`.
  - *Search by name* — for records whose barcode won't scan; pick the matching
    release and it's appended.
- To add an album **by hand**, open `VinylScans.csv` in any editor and add a row,
  leaving the first column empty, then click **Reload** on the home page:

  ```csv
  "","Album Title","Artist Name","https://optional-cover-url.jpg"
  ```

## Data & privacy

- `VinylScans.csv` (your collection) and `covers/` (the image cache) are
  **git-ignored** — they're personal and rebuilt as you scan. The server
  creates an empty `VinylScans.csv` on first run.
- This is a local/LAN tool with **no authentication**. Run it on a trusted
  network; don't expose it to the public internet.

## Files

| File                     | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `barcode_lookup_app.html`| The single-page app (UI + client logic).       |
| `add.html`               | Add-by-name page (search MusicBrainz, append picks). |
| `server.js`              | Static server + `/api/lookup`, `/api/albums`, `/api/search`, `/api/tracks`, `/cover`. |
| `VinylScans.csv`         | Your collection (git-ignored, auto-created).   |
| `covers/`                | Local cover-image cache (git-ignored).         |
| `trackcache/`            | Local tracklist cache (git-ignored).           |
