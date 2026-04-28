/** Tiny country-flag SVGs keyed by country_id (matches original Java schema). */

export function CountryFlag({ countryId, size = 16 }: { countryId: number; size?: number }) {
  switch (countryId) {
    case 1:
      return <USFlag size={size} />;
    default:
      return <USFlag size={size} />;
  }
}

function USFlag({ size }: { size: number }) {
  const h = size * 0.65; // standard flag ratio ~1.54:1
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 190 100"
      width={size}
      height={h}
      role="img"
      aria-label="US Flag"
      className="inline-block shrink-0"
    >
      {/* Red & white stripes */}
      <rect width="190" height="100" fill="#B22234" />
      <rect y="7.69" width="190" height="7.69" fill="#fff" />
      <rect y="23.08" width="190" height="7.69" fill="#fff" />
      <rect y="38.46" width="190" height="7.69" fill="#fff" />
      <rect y="53.85" width="190" height="7.69" fill="#fff" />
      <rect y="69.23" width="190" height="7.69" fill="#fff" />
      <rect y="84.62" width="190" height="7.69" fill="#fff" />
      {/* Blue canton */}
      <rect width="76" height="53.85" fill="#3C3B6E" />
      {/* Stars (simplified 5×4 + 4×3 grid) */}
      {[...Array(5)].map((_, r) =>
        [...Array(6)].map((_, c) => (
          <circle key={`a${r}${c}`} cx={6.3 + c * 12.7} cy={5.4 + r * 10.8} r="2.2" fill="#fff" />
        )),
      )}
      {[...Array(4)].map((_, r) =>
        [...Array(5)].map((_, c) => (
          <circle key={`b${r}${c}`} cx={12.6 + c * 12.7} cy={10.8 + r * 10.8} r="2.2" fill="#fff" />
        )),
      )}
    </svg>
  );
}
