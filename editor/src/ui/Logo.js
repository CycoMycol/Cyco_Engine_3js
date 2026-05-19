/**
 * Logo.js — Cyco Engine logo: a coffee-cup robot.
 * The cup body is the robot's face — gear eyes, grill mouth,
 * steam wisps rising from the top, and a D-handle on the right.
 * Pure inline SVG, recolors via CSS custom properties.
 */

export function createLogo() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', '0 0 48 26');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '26');
  svg.setAttribute('aria-label', 'Cyco Engine');
  svg.style.display = 'block';

  svg.innerHTML = `
    <defs>
      <clipPath id="ce-clip-left-eye">
        <circle cx="16" cy="13" r="3.5"/>
      </clipPath>
      <clipPath id="ce-clip-right-eye">
        <circle cx="32" cy="13" r="3.5"/>
      </clipPath>
    </defs>

    <!-- ── Steam wisps ── -->
    <path d="M 14 5 C 12 3.5 16 2 14 0.5"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1.2"
      stroke-linecap="round" opacity="0.8"/>
    <path d="M 24 4.5 C 22 2.8 26 1.2 24 -0.5"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1.4"
      stroke-linecap="round"/>
    <path d="M 34 5 C 32 3.5 36 2 34 0.5"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1.2"
      stroke-linecap="round" opacity="0.8"/>

    <!-- ── Cup rim ── -->
    <rect x="8" y="4.5" width="32" height="2.5" rx="1.2"
      fill="var(--ce-bg-raised)"
      stroke="var(--ce-accent-orange)" stroke-width="1.1"/>

    <!-- ── Cup body ── -->
    <rect x="9" y="6.5" width="30" height="17.5" rx="3"
      fill="var(--ce-bg-surface)"
      stroke="var(--ce-accent-orange)" stroke-width="1.2"/>

    <!-- ── Handle (D-loop on right) ── -->
    <path d="M 39 10 C 47 10 47 21 39 21"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1.5"
      stroke-linecap="round"/>

    <!-- ── Saucer line ── -->
    <line x1="6" y1="24.5" x2="42" y2="24.5"
      stroke="var(--ce-accent-orange)" stroke-width="1" stroke-linecap="round"
      opacity="0.5"/>

    <!-- ── Left gear eye ── -->
    <circle cx="16" cy="13" r="3.5" fill="var(--ce-bg-base)"/>
    <circle cx="16" cy="13" r="2.4"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1.1"/>
    <g stroke="var(--ce-accent-orange)" stroke-width="1.1" stroke-linecap="round"
       clip-path="url(#ce-clip-left-eye)">
      <line x1="16" y1="10.5" x2="16" y2="15.5"/>
      <line x1="13.5" y1="13" x2="18.5" y2="13"/>
      <line x1="14.2" y1="11.2" x2="17.8" y2="14.8"/>
      <line x1="17.8" y1="11.2" x2="14.2" y2="14.8"/>
    </g>
    <circle cx="16" cy="13" r="1.1" fill="var(--ce-accent-orange)"/>
    <circle cx="16" cy="13" r="3.5"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1"/>

    <!-- ── Right gear eye ── -->
    <circle cx="32" cy="13" r="3.5" fill="var(--ce-bg-base)"/>
    <circle cx="32" cy="13" r="2.4"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1.1"/>
    <g stroke="var(--ce-accent-orange)" stroke-width="1.1" stroke-linecap="round"
       clip-path="url(#ce-clip-right-eye)">
      <line x1="32" y1="10.5" x2="32" y2="15.5"/>
      <line x1="29.5" y1="13" x2="34.5" y2="13"/>
      <line x1="30.2" y1="11.2" x2="33.8" y2="14.8"/>
      <line x1="33.8" y1="11.2" x2="30.2" y2="14.8"/>
    </g>
    <circle cx="32" cy="13" r="1.1" fill="var(--ce-accent-orange)"/>
    <circle cx="32" cy="13" r="3.5"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="1"/>

    <!-- ── Mouth grill ── -->
    <rect x="18" y="19" width="12" height="2.2" rx="1"
      fill="none" stroke="var(--ce-accent-orange)" stroke-width="0.9"/>
    <line x1="22" y1="19" x2="22" y2="21.2"
      stroke="var(--ce-accent-orange)" stroke-width="0.7" opacity="0.7"/>
    <line x1="26" y1="19" x2="26" y2="21.2"
      stroke="var(--ce-accent-orange)" stroke-width="0.7" opacity="0.7"/>

    <!-- ── Cup bolts (top corners) ── -->
    <circle cx="11" cy="9.5" r="1.1"
      fill="var(--ce-bg-raised)" stroke="var(--ce-accent-orange)" stroke-width="0.8"/>
    <circle cx="37" cy="9.5" r="1.1"
      fill="var(--ce-bg-raised)" stroke="var(--ce-accent-orange)" stroke-width="0.8"/>
  `;

  return svg;
}
