# Swiss Trail Planner

Open-source web application for planning hiking routes on official swisstopo
maps and geodata.

The current version displays the Swiss national raster map, the official
swissTLM3D hiking-trail overlay, and lightweight map navigation tools.

## Current features

- full-screen interactive Swiss national map;
- official hiking trails displayed above the base map at detailed zoom levels;
- search for Swiss communes, localities, postal codes, and geographic names;
- selected search result displayed with a map marker;
- large, separated zoom controls;
- one-click browser geolocation with a map marker;
- fullscreen map mode with automatic exit through the Escape key;
- navigation restricted to Switzerland and a small border margin;
- metric scale bar;
- swisstopo attribution;
- no permanent toolbar covering the map.

## Architecture

The current architecture, file responsibilities, technical choices, and
planned evolution are documented in:

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Requirements

Vite 8 requires at least:

- Node.js 20.19 or later; or
- Node.js 22.12 or later.

A recent LTS version is recommended.

Check the installed versions with:

```bash
node --version
npm --version
```

## Installation

From the repository root:

```bash
npm install
npm run dev
```

Vite then displays a local address, usually:

```text
http://localhost:5173/
```

## Location search

The search field uses the official geo.admin.ch `SearchServer` endpoint:

```text
https://api3.geo.admin.ch/rest/services/ech/SearchServer
```

The current search is limited to:

- communes;
- localities and postal codes;
- geographic names printed on the national map.

Search requests start after two characters and a short delay. A newer request
cancels the previous one. Selecting a result places a marker and recenters the
map at zoom level 13.

## Geolocation

The location button requests the user's current position through the browser.

- the user must grant permission;
- `localhost` is accepted during development;
- a deployed version must use HTTPS;
- positions outside the configured Swiss map extent are not displayed.

The application requests a position only when the button is clicked. It does
not continuously track the user.

## Fullscreen mode

The fullscreen button uses the browser Fullscreen API to display the complete
application without the browser chrome. The button changes state while
fullscreen is active, and the browser exits fullscreen when the user presses
`Escape`.

## Production build

```bash
npm run build
```

The generated files are written to `dist/`.

Local preview:

```bash
npm run preview
```

## Deployment

The application is deployed to GitHub Pages through:

```text
.github/workflows/deploy.yml
```

Every push to `main` installs the locked npm dependencies, builds the Vite
application, and deploys the generated `dist/` directory.

The project is configured for a repository site published at:

```text
https://<username>.github.io/swiss-trail-planner/
```

GitHub Pages must be enabled once in the repository settings by selecting
**GitHub Actions** as the Pages source.

## Map sources

Base map:

- XYZ URL template:
  `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.jpeg`
- Layer:
  `ch.swisstopo.pixelkarte-farbe`

Hiking trails:

- XYZ URL template:
  `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.png`
- Layer:
  `ch.swisstopo.swisstlm3d-wanderwege`

Shared settings:

- display projection:
  `EPSG:3857`
- attribution:
  `© swisstopo`

The hiking-trail layer is currently a rendered transparent tile overlay. It is
hidden at overview scales and appears when the view zooms beyond level 12. Raw
vector geometries will be required later for inspection, editing, and routing.

## Next milestone

Load and inspect a small raw swissTLM3D vector sample, including its geometry
and useful trail attributes.

## License

The source code is released under the MIT License.

swisstopo geodata remains subject to its own usage and attribution terms.
