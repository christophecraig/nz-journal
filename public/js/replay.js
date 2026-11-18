// « Rejouer le voyage » : séquence de jours à dérouler sur la grande carte (pur, testable).
import { dayLine } from "./dayview.js";

/**
 * Une image par jour qui a de la géométrie (étapes, itinéraire, trace Coros), dans l'ordre chronologique.
 * @returns {{date:string,title:string,lines:{pts:number[][],routed:boolean,kind:"road"|"run"}[],markers:{lat:number,lng:number,name:string}[],points:number[][]}[]}
 */
export function buildFrames(entries = [], activities = []) {
  const byDate = new Map();
  const frame = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, title: "", lines: [], markers: [], points: [] });
    return byDate.get(date);
  };
  for (const e of entries) {
    if (!e?.date) continue;
    const f = frame(e.date);
    f.title = e.title || "";
    const line = dayLine(e);
    if (line) {
      f.lines.push({ pts: line.pts, routed: line.routed, kind: "road" });
      f.points.push(...line.pts);
    }
    for (const p of e.places || []) {
      f.markers.push({ lat: p.lat, lng: p.lng, name: p.name });
      f.points.push([p.lat, p.lng]);
    }
  }
  for (const a of activities) {
    if (!a?.date || !(a.track?.length > 1)) continue;
    const f = frame(a.date);
    f.lines.push({ pts: a.track, routed: true, kind: "run" });
    f.points.push(...a.track);
  }
  return [...byDate.values()].filter((f) => f.points.length).sort((a, b) => a.date.localeCompare(b.date));
}
