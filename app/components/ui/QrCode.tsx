import { useMemo } from "react";
import { encode } from "uqr";

/**
 * QR code drawn in the browser. Nothing leaves the page: the value is encoded
 * locally instead of being sent to a QR image service.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => {
    // Quiet zone of 2 modules; the caller's white padding supplies the rest.
    const { data, size } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y]?.[x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { size, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
