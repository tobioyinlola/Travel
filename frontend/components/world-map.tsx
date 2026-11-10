'use client';

import { geoCentroid, geoNaturalEarth1, geoPath } from 'd3-geo';
import { Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import { ICON } from './ui';

/** ISO 3166 alpha-2 -> numeric (the ids used by Natural Earth / world-atlas). Destinations we sell, plus common origins. */
const NUMERIC: Record<string, string> = {
  AE: '784',
  AR: '032',
  AT: '040',
  AU: '036',
  BE: '056',
  BR: '076',
  CA: '124',
  CH: '756',
  CN: '156',
  CO: '170',
  CZ: '203',
  DE: '276',
  DK: '208',
  EG: '818',
  ES: '724',
  FI: '246',
  FR: '250',
  GB: '826',
  GE: '268',
  GH: '288',
  GR: '300',
  HR: '191',
  ID: '360',
  IE: '372',
  IN: '356',
  IS: '352',
  IT: '380',
  JP: '392',
  KE: '404',
  KR: '410',
  MA: '504',
  MK: '807',
  MU: '480',
  MV: '462',
  MX: '484',
  MY: '458',
  NG: '566',
  NL: '528',
  NO: '578',
  NZ: '554',
  PE: '604',
  PH: '608',
  PL: '616',
  PT: '620',
  RW: '646',
  SA: '682',
  SC: '690',
  SE: '752',
  SG: '702',
  SN: '686',
  TH: '764',
  TR: '792',
  TZ: '834',
  UG: '800',
  US: '840',
  VN: '704',
  ZA: '710',
  ZW: '716',
};

type Topo = Topology<{ countries: GeometryCollection }>;

/**
 * Light-grey world with the advisor's destination countries in blue and a marker on each (reference: "Active
 * destinations"). Zoom with the +/- control. Static data from Natural Earth via world-atlas (public domain / ISC).
 */
export function WorldMap({ countries, label }: { countries: string[]; label: string }) {
  const [zoom, setZoom] = useState(1);
  const width = 960;
  const height = 500;
  const { shapes, path, markers } = useMemo(() => {
    const fc = feature(
      world as unknown as Topo,
      (world as unknown as Topo).objects.countries,
    ) as unknown as FeatureCollection<Geometry, { name: string }>;
    const projection = geoNaturalEarth1().fitSize([width, height], fc);
    const p = geoPath(projection);
    const wanted = new Set(countries.map((c) => NUMERIC[c.toUpperCase()]).filter(Boolean));
    const markers = fc.features
      .filter((f) => wanted.has(String(f.id)))
      .map((f) => projection(geoCentroid(f)))
      .filter((pt): pt is [number, number] => Boolean(pt));
    return {
      shapes: fc.features.map((f) => ({
        id: String(f.id),
        d: p(f) ?? '',
        active: wanted.has(String(f.id)),
      })),
      path: p,
      markers,
    };
  }, [countries]);
  void path;

  const cx = markers.length ? markers.reduce((a, m) => a + m[0], 0) / markers.length : width / 2;
  const cy = markers.length ? markers.reduce((a, m) => a + m[1], 0) / markers.length : height / 2;

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-canvas">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label={label}
      >
        <g
          transform={`translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`}
          style={{ transition: 'transform 300ms ease' }}
        >
          {shapes.map((s) => (
            <path
              key={s.id}
              d={s.d}
              fill={s.active ? '#1e8bff' : '#d9d9d9'}
              stroke="#f4f4f4"
              strokeWidth={0.6 / zoom}
            />
          ))}
          {markers.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={9 / zoom} fill="#ffffff" opacity="0.45" />
              <circle cx={x} cy={y} r={4.5 / zoom} fill="#ffffff" />
            </g>
          ))}
        </g>
      </svg>
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-surface p-1">
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas"
        >
          <Minus {...ICON} size={16} aria-hidden />
        </button>
        <span className="w-8 text-center text-xs" aria-live="polite">
          {zoom.toFixed(zoom % 1 ? 1 : 0)}x
        </span>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(8, z * 1.5))}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas"
        >
          <Plus {...ICON} size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
