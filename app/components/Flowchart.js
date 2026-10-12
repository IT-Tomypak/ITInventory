// Draws one procedure flowchart from plain data (lib/flowcharts.js) as inline
// SVG. Not an image file: the host's hotlink protection answers .png requests
// with 403 (tools/check-nopng.mjs). Colours are theme tokens, so it follows
// light and dark. Drawn at its natural size; the caller scrolls it if narrow.
//
//   nodes: { t: "start" | "step" | "decision", x, y (centre), w, h, text: [lines] }
//   edges: { pts: [[x, y], ...], label?, at?: [x, y] }
const LINE = 13;

function Shape({ t, x, y, w, h }) {
  const cls = "fill-surface stroke-muted";
  if (t === "decision") {
    return <polygon className={cls} strokeWidth="1.2" points={`${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`} />;
  }
  return <rect className={cls} strokeWidth="1.2" x={x - w / 2} y={y - h / 2} width={w} height={h} rx={t === "start" ? h / 2 : 2} />;
}

export default function Flowchart({ title, width, height, nodes, edges }) {
  return (
    <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      className="max-w-none shrink-0" fontSize="11">
      <defs>
        <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7.5" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="fill-muted" />
        </marker>
      </defs>
      {edges.map((e, i) => (
        <polyline key={i} points={e.pts.map((p) => p.join(",")).join(" ")} className="fill-none stroke-muted" strokeWidth="1.2"
          markerEnd="url(#flow-arrow)" />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <Shape {...n} />
          <text className="fill-fg" textAnchor="middle" x={n.x} y={n.y - ((n.text.length - 1) * LINE) / 2 + 4}>
            {n.text.map((line, j) => <tspan key={j} x={n.x} dy={j ? LINE : 0}>{line}</tspan>)}
          </text>
        </g>
      ))}
      {edges.filter((e) => e.label).map((e, i) => (
        <text key={i} className="fill-danger" fontSize="10" x={e.at[0]} y={e.at[1]}>{e.label}</text>
      ))}
    </svg>
  );
}
