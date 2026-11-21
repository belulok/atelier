// Logo: one of the 3D office agents' heads, drawn as SVG with the same proportions
// as reference/office3d/character.js (face sphere, two eyes with pupils + highlight,
// smile arc). Default color = the agents' team color (content amber).
// Optional, for the voice screen: `mouth` (0–1) opens the mouth while the agent speaks,
// `blink` closes the eyes. With the defaults it draws exactly as before.
export default function AgentHead({ size = 24, color = '#f3b91f', mouth = 0, blink = false }) {
  const eyeRy = blink ? 0.5 : 4.1;
  const pupilRy = blink ? 0.3 : 2.1;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="24" cy="24" r="20" fill={color} />
      <ellipse cx="17" cy="22.5" rx="3.4" ry={eyeRy} fill="#fffdf2" />
      <ellipse cx="31" cy="22.5" rx="3.4" ry={eyeRy} fill="#fffdf2" />
      {!blink && (
        <>
          <ellipse cx="17.8" cy="22.9" rx="1.7" ry={pupilRy} fill="#183040" />
          <ellipse cx="31.8" cy="22.9" rx="1.7" ry={pupilRy} fill="#183040" />
          <circle cx="18.4" cy="22" r=".6" fill="#ffffff" />
          <circle cx="32.4" cy="22" r=".6" fill="#ffffff" />
        </>
      )}
      {mouth > 0.06 ? (
        <ellipse cx="24" cy="31.2" rx={4.2 + mouth * 1.6} ry={0.9 + mouth * 3.6} fill="#183040" />
      ) : (
        <path d="M17.5 30.5 a7.5 7.5 0 0 0 13 0" stroke="#183040" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}
