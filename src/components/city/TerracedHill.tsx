import { useMemo } from 'react';
import { Grid } from '@react-three/drei';
import { HILL, NEON, SCENE } from '@/lib/city/config';
/**
 * Terraced hill (ziggurat): 10x10 outer plinth at Y=0, 8x8 mid platform at
 * Y=+2, 4x4 core summit at Y=+5. Retaining cliff walls between steps carry
 * horizontal neon trim strips. Draw calls stay flat: one slab + one wall band
 * + one trim per step — never per cell.
 *
 * Slabs sink slightly into each other (HILL.overlap) so no coplanar faces
 * z-fight where terraces meet.
 */

function TerraceSlab({
  size,
  topY,
  color,
}: {
  size: number;
  topY: number;
  color: string;
}) {
  const height = topY + HILL.plinthThickness + HILL.overlap;
  return (
    <mesh position={[0, topY - height / 2, 0]}>
      <boxGeometry args={[size, height, size]} />
      <meshStandardMaterial color={color} roughness={0.92} metalness={0.15} />
    </mesh>
  );
}

function RetainingWall({
  size,
  topY,
  bottomY,
  trimColor,
}: {
  size: number;
  topY: number;
  bottomY: number;
  trimColor: string;
}) {
  const wallHeight = topY - bottomY;
  return (
    <group>
      {/* Cliff face: thin shell inset from the terrace edge above it */}
      <mesh position={[0, bottomY + wallHeight / 2, 0]}>
        <boxGeometry args={[size, wallHeight, size]} />
        <meshStandardMaterial color="#080a10" roughness={0.95} metalness={0.3} />
      </mesh>
      {/* Horizontal neon trim strip hugging the top edge of the wall */}
      <mesh position={[0, topY - 0.06, 0]}>
        <boxGeometry args={[size + 0.02, 0.05, size + 0.02]} />
        <meshBasicMaterial color={trimColor} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function TerracedHill({ showGrid }: { showGrid: boolean }) {
  const gridArgs = useMemo(
    () => ({
      cellSize: 1,
      cellThickness: 0.6,
      cellColor: '#1a2430',
      sectionSize: 5,
      sectionThickness: 1.1,
      sectionColor: NEON.cyan,
      fadeDistance: 34,
      fadeStrength: 1.2,
      infiniteGrid: false,
    }),
    [],
  );

  return (
    <group>
      {/* Dark matte world ground, slightly larger than the plinth */}
      <mesh position={[0, -HILL.plinthThickness / 2 - 0.01, 0]} receiveShadow={false}>
        <boxGeometry args={[HILL.groundSize + 4, 0.02, HILL.groundSize + 4]} />
        <meshStandardMaterial color={SCENE.groundColor} roughness={1} metalness={0} />
      </mesh>

      {/* Step 1: 10x10 outer plinth, top at Y = 0 */}
      <TerraceSlab size={HILL.groundSize} topY={HILL.outerY} color="#0a0d14" />

      {/* Step 2: 6x6 mid platform, top at Y = +2 */}
      <RetainingWall size={HILL.midSize} topY={HILL.midY} bottomY={HILL.outerY} trimColor={NEON.cyan} />
      <TerraceSlab size={HILL.midSize} topY={HILL.midY} color="#0b0e16" />

      {/* Step 3: 4x4 core summit, top at Y = +5 */}
      <RetainingWall size={HILL.coreSize} topY={HILL.coreY} bottomY={HILL.midY} trimColor={NEON.magenta} />
      <TerraceSlab size={HILL.coreSize} topY={HILL.coreY} color="#0c0f18" />

      {/* Dev/staging 10x10 grid decal on the outer plinth top (kept for 1.3) */}
      {showGrid ? (
        <Grid
          position={[0, HILL.outerY + HILL.decalLift, 0]}
          args={[10, 10]}
          {...gridArgs}
        />
      ) : null}
    </group>
  );
}
