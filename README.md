# Swiss Trail Planner

Open-source web application for planning hiking routes on official swisstopo
maps and geodata.

The current version is the first project milestone: an interactive swisstopo
raster map that fills the browser window.

## Current features

- full-screen interactive Swiss national map;
- panning and zooming;
- navigation restricted to Switzerland and a small border margin;
- metric scale bar;
- swisstopo attribution;
- error message when the initial tile load fails;
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

## Production build

```bash
npm run build
```

The generated files are written to `dist/`.

Local preview:

```bash
npm run preview
```

## Map source

- XYZ URL template:
  `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.jpeg`
- Layer:
  `ch.swisstopo.pixelkarte-farbe`
- Display projection:
  `EPSG:3857`
- Attribution:
  `© swisstopo`

## Next milestone

Display a first swissTLM3D layer above the raster background, without routing.

## License

The source code is released under the MIT License.

swisstopo geodata remains subject to its own usage and attribution terms.
