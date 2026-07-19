/**
 * Business context: protects local GPX import so external tracks remain
 * read-only, disconnected segments stay separate, and incomplete elevation
 * data never masquerades as a complete reusable profile.
 */
import { describe, expect, it } from 'vitest';
import { GpxImportError, parseGpxRoute } from './gpx';

describe('parseGpxRoute', () => {
  it('preserves independent namespaced track segments and complete elevations', () => {
    const route = parseGpxRoute(
      `<?xml version="1.0"?>
      <gpx xmlns="http://www.topografix.com/GPX/1/1">
        <trk>
          <name>Alpine traverse</name>
          <trkseg>
            <trkpt lat="46.1" lon="7.1"><ele>1000</ele></trkpt>
            <trkpt lat="46.2" lon="7.2"><ele>1100</ele></trkpt>
          </trkseg>
          <trkseg>
            <trkpt lat="46.3" lon="7.3"><ele>1200</ele></trkpt>
            <trkpt lat="46.4" lon="7.4"><ele>1150</ele></trkpt>
          </trkseg>
        </trk>
      </gpx>`,
      'fallback.gpx',
    );

    expect(route).toEqual({
      name: 'Alpine traverse',
      segments: [
        {
          coordinates: [
            [7.1, 46.1],
            [7.2, 46.2],
          ],
          elevationsMeters: [1000, 1100],
        },
        {
          coordinates: [
            [7.3, 46.3],
            [7.4, 46.4],
          ],
          elevationsMeters: [1200, 1150],
        },
      ],
    });
  });

  it('deduplicates consecutive points and retains the useful elevation value', () => {
    const route = parseGpxRoute(
      `<gpx><rte>
        <rtept lat="46" lon="7" />
        <rtept lat="46" lon="7"><ele>500</ele></rtept>
        <rtept lat="46.1" lon="7.1"><ele>550</ele></rtept>
      </rte></gpx>`,
      'route.gpx',
    );

    expect(route.segments[0]).toEqual({
      coordinates: [
        [7, 46],
        [7.1, 46.1],
      ],
      elevationsMeters: [500, 550],
    });
  });

  it('ignores points with missing, empty, or out-of-range coordinates', () => {
    const route = parseGpxRoute(
      `<gpx><rte>
        <rtept lon="7"><ele>100</ele></rtept>
        <rtept lat="" lon="7"><ele>200</ele></rtept>
        <rtept lat="91" lon="7"><ele>300</ele></rtept>
        <rtept lat="46" lon="7"><ele>500</ele></rtept>
        <rtept lat="46.1" lon="7.1"><ele>550</ele></rtept>
      </rte></gpx>`,
      'route.gpx',
    );

    expect(route.segments[0]).toEqual({
      coordinates: [
        [7, 46],
        [7.1, 46.1],
      ],
      elevationsMeters: [500, 550],
    });
  });

  it('marks the complete segment elevation series unavailable when one value is missing', () => {
    const route = parseGpxRoute(
      `<gpx><rte>
        <rtept lat="46" lon="7"><ele>500</ele></rtept>
        <rtept lat="46.1" lon="7.1" />
      </rte></gpx>`,
      'route.gpx',
    );

    expect(route.segments[0].elevationsMeters).toBeNull();
  });

  it('uses metadata and then the filename as readable fallbacks', () => {
    expect(
      parseGpxRoute(
        `<gpx>
          <metadata><name>Metadata route</name></metadata>
          <rte>
            <rtept lat="46" lon="7" />
            <rtept lat="46.1" lon="7.1" />
          </rte>
        </gpx>`,
        'fallback.gpx',
      ).name,
    ).toBe('Metadata route');

    expect(
      parseGpxRoute(
        `<gpx><rte>
          <rtept lat="46" lon="7" />
          <rtept lat="46.1" lon="7.1" />
        </rte></gpx>`,
        '  My hike.GPX  ',
      ).name,
    ).toBe('My hike');
  });

  it('rejects malformed XML and non-GPX documents as invalid', () => {
    for (const xml of ['<gpx><trk>', '<route></route>']) {
      try {
        parseGpxRoute(xml, 'invalid.gpx');
        throw new Error('Expected GPX parsing to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(GpxImportError);
        expect((error as GpxImportError).code).toBe('invalid');
      }
    }
  });

  it('rejects waypoint-only or otherwise empty GPX documents', () => {
    try {
      parseGpxRoute(
        `<gpx><wpt lat="46" lon="7"><name>Summit</name></wpt></gpx>`,
        'waypoints.gpx',
      );
      throw new Error('Expected empty GPX parsing to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(GpxImportError);
      expect((error as GpxImportError).code).toBe('empty');
    }
  });
});
