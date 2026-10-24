export type Point = { x: number; y: number };
export type Matrix = [number, number, number, number, number, number];

export function screenToPdf(point: Point, matrix: Matrix): Point {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-9) throw new Error('Invalid PDF page transform.');
  const dx = point.x - e;
  const dy = point.y - f;
  return { x: (d * dx - c * dy) / determinant, y: (a * dy - b * dx) / determinant };
}

// Angle that keeps newly drawn overlays upright on pages with /Rotate metadata.
export function uprightAngle(matrix: Matrix): number {
  const origin = screenToPdf({ x: 0, y: 0 }, matrix);
  const right = screenToPdf({ x: 1, y: 0 }, matrix);
  return Math.atan2(right.y - origin.y, right.x - origin.x) * 180 / Math.PI;
}

export function normalizedRect(a: Point, b: Point) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

