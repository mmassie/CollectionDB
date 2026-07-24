# Music Catalog

A tiny single-page app for cataloging a record/music collection by scanning
barcodes. Scans are looked up online and saved to a local CSV; a Spotify-style
grid shows your collection, with album covers cached locally so it works
offline after the first load.

![Spotify-style grid of album covers](#)

## Features

- **Scan barcodes** (USB scanner or phone camera keyboard) to add albums.
- **Auto-saves** every scan to `VinylScans.csv` — no export step.
- **Hand-editable CSV**: add albums with no barcode by editing the CSV directly
  (leave the `Barcode` column empty) and clicking **Reload**.
- **Local cover cache**: album art is downloaded once into `covers/` and served
  from disk thereafter.
- **Die Roll**: pick a random album to play next.
- **LAN access**: reachable from your phone on the same Wi-Fi.

## Requirements

- [Node.js](https://nodejs.org/) 16 or newer (no npm packages required).
- A free [RapidAPI](https://rapidapi.com/) account subscribed to the
  **Barcodes Lookup** API (`barcodes1.p.rapidapi.com`), for the lookup key.

## Setup

1. Get a RapidAPI key for the Barcodes Lookup API.
2. Start the server with your key in the environment:

   ```sh
   RAPID_API_KEY=your_key_here node server.js
   ```

   (Or `export RAPID_API_KEY=your_key_here` once, then `node server.js`.)

3. Open **http://localhost:8000/** in your browser.

The server prints a LAN URL too (e.g. `http://192.168.1.50:8000/`) so you can
scan from a phone on the same network.

## Usage

- Click the search box and scan a barcode (or type it and press Enter). The
  album is looked up, added to the grid, and saved to `VinylScans.csv`.
- To add an album **without a barcode**, open `VinylScans.csv` in any editor and
  add a row, leaving the first column empty:

  ```csv
  "","Album Title","Artist Name","https://optional-cover-url.jpg"
  ```

  Then click **Reload** in the app.
- Click any album to see it in the "Next Up" view; **Die Roll** picks one at
  random.

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
| `server.js`              | Static server + `/api/lookup`, `/api/albums`, `/cover`. |
| `VinylScans.csv`         | Your collection (git-ignored, auto-created).   |
| `covers/`                | Local cover-image cache (git-ignored).         |
