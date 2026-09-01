'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CAMERA, CONTROLS, IS_LOW_POWER, LIGHTS, SCENE } from '@/lib/city/config';
import { registerCameraControls } from '@/lib/city/camera-rig';
import { generateInitialGrid } from '@/lib/grid';
import { TerracedHill } from './TerracedHill';
import { Plot } from './TierMeshes';

function ControlsRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    registerCameraControls(controlsRef.current);
    return () => registerCameraControls(null);
  }, []);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={CONTROLS.dampingFactor}
      target={CAMERA.target}
      minZoom={CAMERA.minZoom}
      maxZoom={CAMERA.maxZoom}
      minPolarAngle={CAMERA.minPolarAngle}
      maxPolarAngle={CAMERA.maxPolarAngle}
      enablePan={false}
    />
  );
}

function CityPlots() {
  const plots = useMemo(() => generateInitialGrid(), []);
  return (
    <group>
      {plots.map((plot) => (
        <Plot key={plot.id} plot={plot} />
      ))}
    </group>
  );
}

export function CityScene() {
  return (
    <Canvas
      dpr={IS_LOW_POWER ? [1, 1.5] : [1, 2]}
      gl={{ antialias: !IS_LOW_POWER, powerPreference: 'high-performance' }}
      camera={{
        // Explicit ortho — without this R3F defaults to a PerspectiveCamera,
        // which ignores `zoom` entirely (phase-01 latent bug, fixed in 1.2).
        zoom: CAMERA.zoom,
        position: [...CAMERA.position] as [number, number, number],
        near: 0.1,
        far: 400,
      }}
      orthographic
      style={{ background: SCENE.background }}
    >
      <color attach="background" args={[SCENE.background]} />
      <fog attach="fog" args={[SCENE.background, SCENE.fogNear, SCENE.fogFar]} />

      <ambientLight intensity={LIGHTS.ambient} />
      <directionalLight
        position={LIGHTS.key.position}
        intensity={LIGHTS.key.intensity}
        color={LIGHTS.key.color}
      />
      <directionalLight
        position={LIGHTS.rimCyan.position}
        intensity={LIGHTS.rimCyan.intensity}
        color={LIGHTS.rimCyan.color}
      />
      <directionalLight
        position={LIGHTS.rimMagenta.position}
        intensity={LIGHTS.rimMagenta.intensity}
        color={LIGHTS.rimMagenta.color}
      />

      <TerracedHill showGrid />

      {/* Phase 1.2: static skyline from the seed grid; live data binding is 1.3. */}
      <CityPlots />

      <ControlsRig />
    </Canvas>
  );
}
