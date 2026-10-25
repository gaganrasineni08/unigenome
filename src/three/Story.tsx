// The 3D supply-chain diorama behind the home page. Scroll progress (0..1, from the page) drives the camera
// from the factory, along the road to the warehouse, on to the shop, and finally to a buyer's phone.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Float, Lightformer, RoundedBox } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import QRCode from "qrcode";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

type P = MutableRefObject<number>;
type V3 = [number, number, number];

const C = {
  skyTop: "#0b2f3a",
  skyHorizon: "#f3b48a",
  grass: "#3f8f74",
  grassDark: "#2c6b57",
  slab: "#5b4a3a",
  road: "#2f3b40",
  line: "#f4f1e8",
  wall: "#e9e4d8",
  wallTeal: "#2a7f78",
  roof: "#c75b4a",
  steel: "#8fa3a8",
  mint: "#02C39A",
  sea: "#4fc3f7",
  amber: "#f2a541",
  coral: "#e0675a",
  violet: "#8E7CC3",
  box: "#c9975e",
  glow: "#ffd28a",
};

// Camera keyframes, one per page section: [camera position, look-at target].
const KEYS: Array<[V3, V3]> = [
  [[26, 34, 52], [32, 0, 0]], // overview
  [[-11, 9, 17], [-2, 2.5, 0]], // factory
  [[-1, 6, 12], [2.5, 1.2, 1]], // packing line
  [[8, 9, 20], [13, 1, 3]], // road
  [[21, 11, 23], [27, 2, 0]], // warehouse
  [[52, 8, 18], [57, 2, 0]], // shop
  [[71.5, 3.6, 7.5], [73, 2.6, 0]], // phone scan
  [[36, 38, 58], [38, 0, 0]], // overview again
];
const ROAD = new THREE.CatmullRomCurve3(
  [[11, 4.8], [16, 6.4], [24, 5.2], [34, 6.4], [46, 6.6], [53, 5.2]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function CameraRig({ progress }: { progress: P }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(...KEYS[0][1]));
  const pos = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const l = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const f = clamp(progress.current) * (KEYS.length - 1);
    const i = Math.min(KEYS.length - 2, Math.floor(f));
    const t = smooth(f - i);
    pos.fromArray(KEYS[i][0]).lerp(tmp.fromArray(KEYS[i + 1][0]), t);
    l.fromArray(KEYS[i][1]).lerp(tmp.fromArray(KEYS[i + 1][1]), t);
    // Portrait screens see less width, so pull the camera back along its view line.
    const aspect = size.width / size.height;
    if (aspect < 1.2) pos.sub(l).multiplyScalar(Math.min(2.2, 1.2 / aspect)).add(l);
    const k = 1 - Math.exp(-Math.min(dt, 0.25) * 3.5);
    camera.position.lerp(pos, k);
    look.current.lerp(l, k);
    camera.lookAt(look.current);
  });
  return null;
}

// ---------------------------------------------------------------- building blocks

function Box({ p, s, c, r = 0.05, e, rough = 0.75, metal = 0, rot }: { p: V3; s: V3; c: string; r?: number; e?: number; rough?: number; metal?: number; rot?: V3 }) {
  return (
    <RoundedBox position={p} rotation={rot} args={s} radius={Math.min(r, ...s.map((x) => x / 2.01))} smoothness={3} castShadow receiveShadow>
      <meshStandardMaterial color={c} roughness={rough} metalness={metal} emissive={e ? c : "#000"} emissiveIntensity={e ?? 0} />
    </RoundedBox>
  );
}

/** A glowing window panel, placed clearly in front of its wall so the two never fight for the same depth. */
function Glow({ p, s, c = C.glow, i = 2.2, rot }: { p: V3; s: [number, number]; c?: string; i?: number; rot?: V3 }) {
  return (
    <mesh position={p} rotation={rot}>
      <planeGeometry args={s} />
      <meshStandardMaterial color={c} emissive={c} emissiveIntensity={i} toneMapped={false} />
    </mesh>
  );
}

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color(C.skyTop) }, bottom: { value: new THREE.Color(C.skyHorizon) } },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.15, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0); }",
      }),
    [],
  );
  return (
    <mesh material={mat} position={[38, 0, 0]}>
      <sphereGeometry args={[260, 32, 16]} />
    </mesh>
  );
}

function Ground() {
  return (
    <group>
      {/* the diorama slab: grass on top, earth on the sides */}
      <Box p={[37, -1.5, 1]} s={[118, 3, 40]} c={C.slab} r={0.8} />
      <mesh position={[37, 0.02, 1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[116.4, 38.4]} />
        <meshStandardMaterial color={C.grass} roughness={1} />
      </mesh>
      {/* a pond */}
      <mesh position={[40, 0.045, -9]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[4.5, 48]} />
        <meshStandardMaterial color="#3aa6c9" roughness={0.15} metalness={0.3} />
      </mesh>
    </group>
  );
}

function Road() {
  const { geo, edges } = useMemo(() => {
    // A flat ribbon following the curve, slightly above the grass.
    const n = 160;
    const pos: number[] = [];
    const idx: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = ROAD.getPointAt(u);
      const side = new THREE.Vector3().crossVectors(ROAD.getTangentAt(u), up).normalize().multiplyScalar(1.5);
      pos.push(p.x + side.x, 0.06, p.z + side.z, p.x - side.x, 0.06, p.z - side.z);
      if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const dashes = Array.from({ length: 46 }, (_, i) => {
      const u = (i + 0.5) / 46;
      const p = ROAD.getPointAt(u);
      const t = ROAD.getTangentAt(u);
      return { p, a: Math.atan2(-t.z, t.x) };
    });
    return { geo: g, edges: dashes };
  }, []);
  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial color={C.road} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {edges.map((d, i) => (
        <mesh key={i} position={[d.p.x, 0.09, d.p.z]} rotation={[-Math.PI / 2, 0, d.a]}>
          <planeGeometry args={[0.7, 0.1]} />
          <meshBasicMaterial color={C.line} />
        </mesh>
      ))}
      {[0.08, 0.3, 0.52, 0.74, 0.94].map((u) => {
        const p = ROAD.getPointAt(u);
        return <Lamp key={u} p={[p.x, 0, p.z - 2.2]} />;
      })}
    </group>
  );
}

function Lamp({ p }: { p: V3 }) {
  return (
    <group position={p}>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 2.8, 8]} />
        <meshStandardMaterial color="#38474c" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 2.85, 0]}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color={C.glow} emissive={C.glow} emissiveIntensity={3} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Tree({ p, s = 1, kind = 0 }: { p: V3; s?: number; kind?: number }) {
  const greens = ["#2f8a63", "#3c9b6b", "#257a5a", "#4aa874"];
  return (
    <group position={p} scale={s}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.13, 0.9, 6]} />
        <meshStandardMaterial color="#6b4e37" />
      </mesh>
      {kind % 2 ? (
        <mesh position={[0, 1.35, 0]} castShadow>
          <icosahedronGeometry args={[0.75, 0]} />
          <meshStandardMaterial color={greens[kind % 4]} flatShading roughness={0.9} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, 1.25, 0]} castShadow>
            <coneGeometry args={[0.7, 1.3, 7]} />
            <meshStandardMaterial color={greens[kind % 4]} flatShading />
          </mesh>
          <mesh position={[0, 1.85, 0]} castShadow>
            <coneGeometry args={[0.5, 1, 7]} />
            <meshStandardMaterial color={greens[(kind + 1) % 4]} flatShading />
          </mesh>
        </>
      )}
    </group>
  );
}

function Trees() {
  const spots = useMemo(() => {
    const out: Array<{ p: V3; s: number; k: number }> = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 70; i++) {
      const x = -18 + rnd() * 112;
      const z = rnd() > 0.5 ? 10 + rnd() * 9 : -8 - rnd() * 10;
      // keep clear of buildings and the pond
      if ((x > -6 && x < 9 && z > -6) || (x > 22 && x < 37 && z > -6) || (x > 52 && x < 67 && z > -6) || Math.hypot(x - 40, z + 9) < 5.5) continue;
      out.push({ p: [x, 0, z], s: 0.7 + rnd() * 0.7, k: Math.floor(rnd() * 8) });
    }
    return out;
  }, []);
  return (
    <>
      {spots.map((t, i) => (
        <Tree key={i} p={t.p} s={t.s} kind={t.k} />
      ))}
    </>
  );
}

function Clouds() {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    g.current?.children.forEach((c, i) => {
      c.position.x += dt * (0.4 + i * 0.07);
      if (c.position.x > 110) c.position.x = -30;
    });
  });
  const puffs = [
    [-10, 16, -14],
    [18, 19, -18],
    [44, 17, -15],
    [70, 20, -20],
    [92, 18, -12],
  ];
  return (
    <group ref={g}>
      {puffs.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]} scale={1 + (i % 3) * 0.3}>
          {[[-1.2, 0, 0, 1.1], [0, 0.4, 0, 1.5], [1.3, 0.1, 0, 1.15], [0.4, -0.2, 0.6, 1]].map(([a, b, c, r], j) => (
            <mesh key={j} position={[a, b, c]}>
              <sphereGeometry args={[r, 16, 12]} />
              <meshStandardMaterial color="#fff6ee" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** A floating location pin with a pulsing ring: every scan records where it happened. */
function Pin({ p, c }: { p: V3; c: string }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const t = (clock.elapsedTime * 0.6) % 1;
    ring.current.scale.setScalar(0.5 + t * 2.5);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
  });
  return (
    <group position={p}>
      <Float speed={2} floatIntensity={0.8} rotationIntensity={0}>
        <mesh position={[0, 0.9, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.45, 1.1, 24]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, 1.55, 0]}>
          <sphereGeometry args={[0.47, 24, 16]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, 1.55, 0.42]}>
          <sphereGeometry args={[0.17, 16, 12]} />
          <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={1.5} toneMapped={false} />
        </mesh>
      </Float>
      <mesh ref={ring} position={[0, -p[1] + 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.62, 48]} />
        <meshBasicMaterial color={c} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- the places

function Factory() {
  const smoke = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    smoke.current?.children.forEach((m, i) => {
      const chimney = i % 2;
      const t = (clock.elapsedTime * 0.25 + i / 8) % 1;
      m.position.set((chimney ? -4.2 : -2.4) + t * 1.4, 7.2 + t * 4, -2.4);
      m.scale.setScalar(0.35 + t * 1.1);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.55 * (1 - t);
    });
  });
  return (
    <group>
      {/* main hall */}
      <Box p={[-1.5, 1.8, -1.5]} s={[9, 3.6, 5]} c={C.wall} />
      <Box p={[-1.5, 0.2, -1.5]} s={[9.2, 0.4, 5.2]} c="#b9b2a2" r={0.03} />
      {/* pitched roof: two slanted panels meeting at the ridge */}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[-1.5, 4.25, -1.5 + k * 1.3]} rotation={[k * 0.5, 0, 0]} castShadow>
          <boxGeometry args={[9.6, 0.18, 2.95]} />
          <meshStandardMaterial color={C.roof} roughness={0.7} />
        </mesh>
      ))}
      {/* skylights on the front slope */}
      {[-4.2, -1.5, 1.2].map((x) => (
        <Glow key={x} p={[x, 4.37, -0.2]} s={[1.2, 0.9]} rot={[-Math.PI / 2 + 0.5, 0, 0]} c="#bfe9ff" i={1.1} />
      ))}
      {/* windows on the front wall (wall face at z = 1.0) */}
      {[-4.8, -3.1, -1.4, 0.3, 2].map((x) => (
        <Glow key={x} p={[x, 2.1, 1.04]} s={[1.1, 1.1]} />
      ))}
      {/* chimneys */}
      {[-2.4, -4.2].map((x, i) => (
        <group key={x} position={[x, 0, -2.4]}>
          <mesh position={[0, 5, 0]} castShadow>
            <cylinderGeometry args={[0.32, 0.42, 3.4 + i * 0.6, 20]} />
            <meshStandardMaterial color="#f1ece2" />
          </mesh>
          <mesh position={[0, 6.2 + i * 0.3, 0]}>
            <cylinderGeometry args={[0.335, 0.335, 0.35, 20]} />
            <meshStandardMaterial color={C.coral} />
          </mesh>
        </group>
      ))}
      <group ref={smoke}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.5, 14, 10]} />
            <meshStandardMaterial color="#f4f0ea" transparent opacity={0.4} depthWrite={false} />
          </mesh>
        ))}
      </group>
      {/* company sign */}
      <Box p={[-1.5, 4.05, 1.1]} s={[3, 0.6, 0.12]} c={C.wallTeal} r={0.05} />
      <Glow p={[-1.5, 4.05, 1.18]} s={[2.6, 0.32]} c={C.mint} i={2.5} />
      <Conveyor />
    </group>
  );
}

// Items ride the belt, pass the signing arch (and turn mint: signed), then drop into a carton.
function Conveyor() {
  const items = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    items.current?.children.forEach((m, i) => {
      const t = (clock.elapsedTime * 0.16 + i / 8) % 1;
      m.position.set(0.2 + t * 5.6, 1.33, 2.6);
      const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const signed = t > 0.48;
      mat.color.set(signed ? "#dff8ef" : "#f4f1e8");
      mat.emissive.set(signed ? C.mint : "#000");
      mat.emissiveIntensity = signed ? 0.6 : 0;
    });
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.2 * Math.sin(clock.elapsedTime * 6);
  });
  return (
    <group>
      <Box p={[3, 0.95, 2.6]} s={[6.4, 0.3, 1.1]} c="#3a4b50" r={0.06} metal={0.3} rough={0.5} />
      {[0.4, 2.2, 4, 5.8].map((x) => (
        <Box key={x} p={[x, 0.4, 2.6]} s={[0.15, 0.8, 0.9]} c="#52666b" r={0.03} />
      ))}
      <group ref={items}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} castShadow>
            <boxGeometry args={[0.34, 0.46, 0.34]} />
            <meshStandardMaterial color="#f4f1e8" />
          </mesh>
        ))}
      </group>
      {/* signing arch with a scanning beam */}
      <group position={[2.9, 0, 2.6]}>
        <Box p={[0, 1.4, -0.7]} s={[0.18, 1.8, 0.18]} c={C.wallTeal} />
        <Box p={[0, 1.4, 0.7]} s={[0.18, 1.8, 0.18]} c={C.wallTeal} />
        <Box p={[0, 2.35, 0]} s={[0.4, 0.3, 1.6]} c={C.wallTeal} />
        <mesh ref={beam} position={[0, 1.75, 0]}>
          <boxGeometry args={[0.04, 0.9, 1.2]} />
          <meshBasicMaterial color={C.mint} transparent opacity={0.4} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <Carton p={[6.9, 0.6, 2.6]} glow />
    </group>
  );
}

function Carton({ p, glow }: { p: V3; glow?: boolean }) {
  return (
    <group position={p}>
      <Box p={[0, 0, 0]} s={[1.1, 1.1, 1.1]} c={C.box} r={0.05} />
      <Box p={[0, 0.57, 0]} s={[1.12, 0.03, 0.18]} c="#a77a45" r={0.005} />
      {glow ? <Glow p={[0, 0.12, 0.58]} s={[0.42, 0.42]} c={C.mint} i={1.6} /> : <Glow p={[0, 0.12, 0.58]} s={[0.4, 0.4]} c="#f7f4ec" i={0.15} />}
    </group>
  );
}

function Warehouse() {
  const lift = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (lift.current) lift.current.position.x = -1 + Math.sin(clock.elapsedTime * 0.6) * 2.2;
  });
  return (
    <group position={[29.5, 0, -1.5]}>
      <Box p={[0, 2.2, 0]} s={[11, 4.4, 6]} c="#d9dfdc" />
      {/* gable roof (two slanted panels meeting at the ridge) */}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, 4.95, k * 1.55]} rotation={[k * 0.45, 0, 0]} castShadow>
          <boxGeometry args={[11.6, 0.18, 3.5]} />
          <meshStandardMaterial color={C.wallTeal} roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      {/* roll-up doors and dock lights (wall face at z = 3) */}
      {[-3, 0, 3].map((x, i) => (
        <group key={x}>
          <Box p={[x, 1.4, 3.06]} s={[2.2, 2.6, 0.1]} c={i === 1 ? "#26363a" : "#9fb0b3"} r={0.03} />
          <Glow p={[x, 2.95, 3.14]} s={[0.6, 0.12]} c={C.amber} i={2.4} />
        </group>
      ))}
      {/* pallet of cartons out front, with the scan beam: one scan updates everything on it */}
      <group position={[-3.6, 0, 5.4]}>
        <Box p={[0, 0.12, 0]} s={[2.5, 0.24, 2.5]} c="#8a6a48" r={0.03} />
        {[0, 1].flatMap((y) => [-0.58, 0.58].flatMap((x) => [-0.58, 0.58].map((z) => <Carton key={`${x}${y}${z}`} p={[x, 0.82 + y * 1.12, z]} />)))}
        <Beam p={[0, 1.45, 0]} />
        <Float speed={2} floatIntensity={0.5}>
          <Box p={[0, 3.6, 0]} s={[0.8, 0.8, 0.06]} c={C.mint} e={1.4} r={0.03} />
        </Float>
      </group>
      {/* a forklift going back and forth */}
      <group ref={lift} position={[0, 0, 4.6]}>
        <Box p={[0, 0.55, 0]} s={[1.2, 0.7, 0.8]} c={C.amber} />
        <Box p={[-0.2, 1.15, 0]} s={[0.6, 0.6, 0.7]} c="#2b3a3f" />
        <Box p={[0.7, 0.9, 0]} s={[0.08, 1.5, 0.7]} c="#45555a" />
        {[-0.35, 0.35].flatMap((x) => [-0.42, 0.42].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.22, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.12, 16]} />
            <meshStandardMaterial color="#1b2326" />
          </mesh>
        )))}
      </group>
    </group>
  );
}

function Beam({ p }: { p: V3 }) {
  const m = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!m.current) return;
    m.current.position.y = p[1] + Math.sin(clock.elapsedTime * 1.6) * 1.1;
  });
  return (
    <mesh ref={m} position={p} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[2.9, 2.9]} />
      <meshBasicMaterial color={C.mint} transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Shop() {
  return (
    <group position={[59.5, 0, -1.5]}>
      <Box p={[0, 1.9, 0]} s={[8, 3.8, 5]} c="#f2e9da" />
      <Box p={[0, 3.95, 0]} s={[8.3, 0.3, 5.3]} c="#7c5a46" r={0.05} />
      {/* striped awning (front wall at z = 2.5) */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-3.5 + i, 3.05, 3.05]} rotation={[0.55, 0, 0]} castShadow>
          <boxGeometry args={[1, 0.06, 1.3]} />
          <meshStandardMaterial color={i % 2 ? C.coral : "#fff8ee"} />
        </mesh>
      ))}
      {/* shop window and door */}
      <Glow p={[-1.2, 1.35, 2.54]} s={[4.2, 1.9]} c="#fff1cf" i={1.1} />
      <Box p={[2.4, 1.15, 2.56]} s={[1.3, 2.3, 0.08]} c={C.wallTeal} r={0.03} />
      {/* sign */}
      <Box p={[0, 4.55, 2.2]} s={[3.6, 0.8, 0.14]} c={C.wallTeal} r={0.06} />
      <Glow p={[0, 4.55, 2.3]} s={[3.2, 0.45]} c={C.amber} i={2.4} />
      {/* items on display, in front of the lit window */}
      {[0.75, 1.55].flatMap((y) => Array.from({ length: 7 }, (_, i) => <Box key={y + ":" + i} p={[-3 + i * 0.6, y, 2.75]} s={[0.3, 0.42, 0.3]} c={i % 3 ? "#f7f4ec" : C.mint} r={0.03} />))}
      <Box p={[-1.2, 0.5, 2.8]} s={[4.4, 0.08, 0.5]} c="#7c5a46" r={0.02} />
      <Box p={[-1.2, 1.3, 2.8]} s={[4.4, 0.08, 0.5]} c="#7c5a46" r={0.02} />
    </group>
  );
}

// The truck drives factory -> warehouse during section 3 and warehouse -> shop during section 5.
function Truck({ progress }: { progress: P }) {
  const g = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Group>(null);
  const last = useRef(0);
  useFrame(() => {
    const f = clamp(progress.current) * (KEYS.length - 1);
    const leg1 = smooth(clamp((f - 2.2) / 1.6)) * 0.5;
    const leg2 = smooth(clamp((f - 4.2) / 1.0)) * 0.5;
    const u = clamp(leg1 + leg2, 0, 0.999);
    const p = ROAD.getPointAt(u);
    const tan = ROAD.getTangentAt(u);
    const side = new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(0.7); // drive in the left lane
    g.current?.position.set(p.x + side.x, 0.06, p.z + side.z);
    g.current?.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
    wheels.current?.children.forEach((w) => (w.rotation.y -= (u - last.current) * 300));
    last.current = u;
  });
  return (
    <group ref={g} scale={0.9}>
      {/* trailer with the UniGenome stripe */}
      <Box p={[-0.5, 1.15, 0]} s={[2.8, 1.5, 1.25]} c="#f7f4ec" r={0.08} />
      <Box p={[-0.5, 1.15, 0.645]} s={[2.4, 0.22, 0.02]} c={C.mint} r={0.01} e={0.4} />
      <Box p={[-0.5, 1.15, -0.645]} s={[2.4, 0.22, 0.02]} c={C.mint} r={0.01} e={0.4} />
      {/* cab */}
      <Box p={[1.45, 0.85, 0]} s={[1, 1.1, 1.2]} c={C.amber} r={0.12} />
      <Box p={[1.62, 1.12, 0]} s={[0.68, 0.42, 1.1]} c="#a9dcef" r={0.06} rough={0.1} metal={0.3} />
      {[0.42, -0.42].map((z) => (
        <Glow key={z} p={[1.96, 0.62, z]} s={[0.22, 0.14]} rot={[0, Math.PI / 2, 0]} c="#fff6d0" i={4} />
      ))}
      <Box p={[0, 0.38, 0]} s={[3.9, 0.16, 0.9]} c="#2b3438" r={0.02} />
      <group ref={wheels}>
        {[-1.35, -0.55, 1.4].flatMap((x) => [0.6, -0.6].map((z) => (
          <group key={x + ":" + z} position={[x, 0.32, z]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.32, 0.32, 0.22, 20]} />
              <meshStandardMaterial color="#161c1f" roughness={0.9} />
            </mesh>
          </group>
        )))}
      </group>
    </group>
  );
}

/** A couple of cars driving along the road all the time, so the world feels alive. */
function Traffic() {
  const cars = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    cars.current?.children.forEach((c, i) => {
      const dir = i % 2 ? 1 : -1;
      let u = (clock.elapsedTime * 0.025 + i * 0.37) % 1;
      if (dir < 0) u = 1 - u;
      u = clamp(u, 0.001, 0.999);
      const p = ROAD.getPointAt(u);
      const t = ROAD.getTangentAt(u).multiplyScalar(dir);
      const side = new THREE.Vector3(t.z, 0, -t.x).multiplyScalar(0.7);
      c.position.set(p.x + side.x, 0.06, p.z + side.z);
      c.rotation.y = Math.atan2(-t.z, t.x);
    });
  });
  return (
    <group ref={cars}>
      {[C.sea, C.coral, C.violet].map((col) => (
        <group key={col} scale={0.75}>
          <Box p={[0, 0.45, 0]} s={[1.6, 0.5, 0.85]} c={col} r={0.15} metal={0.2} rough={0.4} />
          <Box p={[-0.1, 0.85, 0]} s={[0.9, 0.4, 0.78]} c="#bfe3ef" r={0.12} rough={0.1} />
          {[-0.5, 0.5].flatMap((x) => [0.42, -0.42].map((z) => (
            <mesh key={x + ":" + z} position={[x, 0.2, z]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.14, 16]} />
              <meshStandardMaterial color="#161c1f" />
            </mesh>
          )))}
        </group>
      ))}
    </group>
  );
}

function Phone() {
  const tex = useMemo(() => {
    const cv = document.createElement("canvas");
    QRCode.toCanvas(cv, "https://unigenome.app/v#demo", { margin: 1, width: 256, color: { dark: "#052024", light: "#ffffff" } });
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const laser = useRef<THREE.Mesh>(null);
  const tick = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (laser.current) laser.current.position.y = 0.25 + Math.sin(clock.elapsedTime * 2.2) * 0.58;
    if (tick.current) tick.current.scale.setScalar(0.9 + 0.1 * Math.sin(clock.elapsedTime * 3));
  });
  return (
    <group position={[75, 2.7, 0.5]}>
      {/* a little counter for the product to sit on */}
      <Box p={[-1.6, -2.15, 0.5]} s={[2.2, 1.1, 1.6]} c="#7c5a46" r={0.08} />
      <Box p={[-1.6, -1.15, 0.5]} s={[0.7, 0.9, 0.7]} c="#f7f4ec" />
      <Glow p={[-1.6, -1.05, 0.86]} s={[0.4, 0.4]} c={C.mint} i={1.2} />
      <Float speed={1.4} rotationIntensity={0.2} floatIntensity={0.5}>
        <group rotation={[0, -0.25, 0]}>
          <Box p={[0, 0, 0]} s={[1.9, 3.6, 0.18]} c="#151b1e" r={0.22} rough={0.3} metal={0.4} />
          <mesh position={[0, 0, 0.095]}>
            <planeGeometry args={[1.7, 3.35]} />
            <meshStandardMaterial color="#0c2a2d" emissive="#0c2a2d" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, 0.25, 0.1]}>
            <planeGeometry args={[1.3, 1.3]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
          <mesh ref={laser} position={[0, 0.25, 0.11]}>
            <planeGeometry args={[1.4, 0.04]} />
            <meshBasicMaterial color={C.mint} toneMapped={false} />
          </mesh>
          <group ref={tick} position={[0, -1.1, 0.11]}>
            <mesh>
              <circleGeometry args={[0.3, 40]} />
              <meshBasicMaterial color={C.mint} toneMapped={false} />
            </mesh>
            <mesh position={[-0.07, -0.02, 0.005]} rotation={[0, 0, -0.8]}>
              <planeGeometry args={[0.14, 0.05]} />
              <meshBasicMaterial color="#04332c" />
            </mesh>
            <mesh position={[0.05, 0.03, 0.005]} rotation={[0, 0, 0.9]}>
              <planeGeometry args={[0.26, 0.05]} />
              <meshBasicMaterial color="#04332c" />
            </mesh>
          </group>
        </group>
      </Float>
    </group>
  );
}

export default function Story({ progress }: { progress: P }) {
  const dpr = Math.min(1.75, window.devicePixelRatio || 1);
  return (
    <Canvas shadows dpr={dpr} camera={{ position: KEYS[0][0], fov: 40, near: 0.5, far: 600 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <fog attach="fog" args={[C.skyHorizon, 70, 190]} />
      <Sky />
      <mesh position={[120, 22, -180]}>
        <sphereGeometry args={[12, 32, 16]} />
        <meshBasicMaterial color="#fff1d6" toneMapped={false} fog={false} />
      </mesh>
      <hemisphereLight args={["#ffe9d6", "#2b5a50", 1.1]} />
      <directionalLight
        position={[60, 45, 35]}
        intensity={2.6}
        color="#ffe2c4"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={200}
      >
        <object3D attach="target" position={[37, 0, 0]} />
      </directionalLight>
      {/* soft studio reflections, built locally (no downloads) */}
      <Environment resolution={128}>
        <Lightformer intensity={2} color="#ffd9b8" position={[0, 6, -8]} scale={[20, 6, 1]} />
        <Lightformer intensity={1.2} color="#bdf3ff" position={[-8, 3, 6]} scale={[10, 4, 1]} />
        <Lightformer form="ring" intensity={1.5} color="#ffffff" position={[6, 8, 4]} scale={3} />
      </Environment>
      <CameraRig progress={progress} />
      <Ground />
      <Road />
      <Trees />
      <Clouds />
      <Factory />
      <Warehouse />
      <Shop />
      <Truck progress={progress} />
      <Traffic />
      <Phone />
      <Pin p={[-1.5, 6.6, 1]} c={C.mint} />
      <Pin p={[29.5, 7, 1.5]} c={C.sea} />
      <Pin p={[59.5, 6.2, 1.5]} c={C.amber} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.85} luminanceSmoothing={0.2} />
        <Vignette eskil={false} offset={0.25} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
