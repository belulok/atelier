// Logo: one of the 3D office agents' heads, drawn as SVG with the same proportions
// as reference/office3d/character.js (face sphere, two eyes with pupils + highlight,
// smile arc). Default color = the agents' team color (content amber).
export default function AgentHead({ size = 24, color = '#f3b91f' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="24" cy="24" r="20" fill={color} />
      <ellipse cx="17" cy="22.5" rx="3.4" ry="4.1" fill="#fffdf2" />
      <ellipse cx="31" cy="22.5" rx="3.4" ry="4.1" fill="#fffdf2" />
      <ellipse cx="17.8" cy="22.9" rx="1.7" ry="2.1" fill="#183040" />
      <ellipse cx="31.8" cy="22.9" rx="1.7" ry="2.1" fill="#183040" />
      <circle cx="18.4" cy="22" r=".6" fill="#ffffff" />
      <circle cx="32.4" cy="22" r=".6" fill="#ffffff" />
      <path d="M17.5 30.5 a7.5 7.5 0 0 0 13 0" stroke="#183040" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
