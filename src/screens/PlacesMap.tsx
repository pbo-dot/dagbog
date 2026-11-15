// Lille kort med de steder, man har været (Leaflet + OpenStreetMap). Leaflet hentes først, når et kort
// skal vises, så resten af appen ikke bliver tungere. Faste steder (fx sommerhuset) vises som en ring
// på FIXED_KM, så man kan se, hvad der regnes som stedet.
import { useEffect, useRef, useState } from 'react';
import { FIXED_KM, type Stay } from '../lib/places';
import type { FixedPlace } from '../lib/types';

export interface MapPoint { lat: number; lng: number; label: string }

/** Ophold med sted → punkter til kortet ("Rønne · 12.16–13.59"). */
export function stayPoints(stays: Stay[], time: (s: Stay) => string, prefix = ''): MapPoint[] {
  return stays.filter((s) => s.lat !== undefined && s.lng !== undefined)
    .map((s) => ({ lat: s.lat!, lng: s.lng!, label: `${prefix}${s.city} · ${time(s)}` }));
}

export function PlacesMap({ points, fixed = [], height = 240 }: { points: MapPoint[]; fixed?: FixedPlace[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  // Kortet tegnes forfra, når stederne ændrer sig
  const key = JSON.stringify([points, fixed.map((f) => [f.lat, f.lng, f.name])]);
  useEffect(() => {
    if (!box.current || !points.length) return;
    let map: import('leaflet').Map | null = null;
    let dead = false;
    (async () => {
      try {
        const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (dead || !box.current) return;
        map = L.map(box.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
        map.attributionControl.setPrefix('Leaflet');
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f6b57';
        for (const f of fixed) {
          L.circle([f.lat, f.lng], { radius: FIXED_KM * 1000, color: '#c98a1b', weight: 2, dashArray: '6 6', fillOpacity: 0.06 })
            .bindTooltip(`🏡 ${f.name} (${FIXED_KM} km)`).addTo(map);
        }
        const ll = points.map((p) => [p.lat, p.lng] as [number, number]);
        if (ll.length > 1) L.polyline(ll, { color: accent, weight: 3, opacity: 0.5 }).addTo(map);
        points.forEach((p, i) => {
          L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 2, fillColor: accent, fillOpacity: 1 })
            .bindPopup(`<b>${i + 1}.</b> ${p.label.replace(/</g, '&lt;')}`).addTo(map!);
        });
        if (ll.length === 1) map.setView(ll[0], 12);
        else map.fitBounds(L.latLngBounds(ll), { padding: [28, 28], maxZoom: 14 });
      } catch (e) {
        setError(`Kortet kunne ikke vises (${e instanceof Error ? e.message : 'ukendt fejl'}).`);
      }
    })();
    return () => { dead = true; map?.remove(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!points.length) return null;
  if (error) return <p className="small muted">{error}</p>;
  return <div ref={box} className="places-map" style={{ height }} role="img" aria-label={`Kort med ${points.length} ${points.length === 1 ? 'sted' : 'steder'}`} />;
}
