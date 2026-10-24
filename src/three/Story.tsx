// The 3D supply-chain scene behind the home page. Scroll progress (0..1, from the page) drives the camera
// from the factory, along the road to the warehouse, on to the shop, and finally to a buyer's phone.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Float, RoundedBox } from "@react-three/drei";
import QRCode from "qrcode";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

type P = MutableRefObject<number>;
const C = { ground: "#0a3438", road: "#123f44", line: "#e7f4f2", teal: "#00A896", mint: "#02C39A", sea: "#4fc3f7", amber: "#E8A33D", coral: "#D96C6C", violet: "#8E7CC3", wall: "#1d6a72", roof: "#e7f4f2", box: "#c9a26b" };

// Camera keyframes, one per page section: [camera position, look-at target].
const KEYS: Array<[[number, number, number], [number, number, number]]> = [
  [[22, 30, 46], [30, 0, 0]], // overview
  [[-10, 8, 15], [-3, 2, 0]], // factory
  [[0, 6, 11], [1, 1.2, 0]], // packing line
  [[8, 8, 18], [12, 1, 2]], // road
  [[20, 10, 22], [26, 2, 0]], // warehouse
  [[52, 7, 17], [56, 2, 0]], // shop
  [[71, 3.4, 7.5], [72.5, 2.4, 0]], // phone scan
  [[34, 34, 52], [36, 0, 0]], // overview again
];const ROAD = new THREE.CatmullRomCurve3([new THREE.Vector3(10, 0.05, 3.5), new THREE.Vector3(16, 0.05, 6), new THREE.Vector3(24, 0.05, 4.5), new THREE.Vector3(34, 0.05, 5.5), new THREE.Vector3(46, 0.05, 6), new THREE.Vector3(53, 0.05, 5)]);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function CameraRig({ progress }: { progress: P }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(...KEYS[0][1]));
  const pos = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  useFrame((_, dt) => {
    const f = clamp(progress.current) * (KEYS.length - 1);
    const i = Math.min(KEYS.length - 2, Math.floor(f));
    const t = smooth(f - i);
    pos.fromArray(KEYS[i][0]).lerp(tgt.fromArray(KEYS[i + 1][0]), t);
    const l = new THREE.Vector3().fromArray(KEYS[i][1]).lerp(tgt.fromArray(KEYS[i + 1][1]), t);
    // Portrait screens see less width, so pull the camera back along its view line.
    const aspect = size.width / size.height;
    if (aspect < 1.2) pos.sub(l).multiplyScalar(Math.min(2.2, 1.2 / aspect)).add(l);
    const k = 1 - Math.exp(-dt * 4);
    camera.position.lerp(pos, k);
    look.current.lerp(l, k);
    camera.lookAt(look.current);
  });
  return null;
}

function Box({ p, s, c, r = 0.06, e }: { p: [number, number, number]; s: [number, number, number]; c: string; r?: number; e?: number }) {
  return (
    <RoundedBox position={p} args={s} radius={r} smoothness={2} castShadow receiveShadow>
      <meshStandardMaterial color={c} roughness={0.6} emissive={e ? c : "#000"} emissiveIntensity={e ?? 0} />
    </RoundedBox>
  );
}

function Factory() {
  const smoke = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    smoke.current?.children.forEach((m, i) => {
      const t = (clock.elapsedTime * 0.35 + i / 6) % 1;
      m.position.set(-2.2 + t * 0.8, 6.2 + t * 3.2, -1.4);
      m.scale.setScalar(0.3 + t * 0.9);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - t);
    });
  });
  return (
    <group>
      <Box p={[-1, 1.6, -1]} s={[6, 3.2, 4]} c={C.wall} />
      {[-3, -1, 1].map((x) => (
        <mesh key={x} position={[x, 3.6, -1]} rotation={[0, 0, Math.PI / 4]} castShadow>
          <boxGeometry args={[1.45, 1.45, 4]} />
          <meshStandardMaterial color={C.roof} roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[-2.2, 4.4, -1.4]} castShadow>
        <cylinderGeometry args={[0.35, 0.45, 3.6, 16]} />
        <meshStandardMaterial color={C.coral} />
      </mesh>
      <group ref={smoke}>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.5, 12, 12]} />
            <meshStandardMaterial color="#cfe" transparent opacity={0.4} />
          </mesh>
        ))}
      </group>
      {[-3, -1.2, 0.6].map((x) => <Box key={x} p={[x, 1.6, 1.02]} s={[1, 1, 0.05]} c={C.sea} e={0.6} r={0.02} />)}
      <Conveyor />
    </group>
  );
}

// Items ride the belt, get a glowing QR stamp at the signing station, then drop into a carton.
function Conveyor() {
  const items = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    items.current?.children.forEach((m, i) => {
      const t = (clock.elapsedTime * 0.18 + i / 7) % 1;
      m.position.set(1.4 + t * 4.6, 1.25, 1.9);
      const stamped = t > 0.42;
      const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissive.set(stamped ? C.mint : "#000");
      mat.emissiveIntensity = stamped ? 0.8 : 0;
    });
  });
  return (
    <group>
      <Box p={[3.7, 0.95, 1.9]} s={[5.4, 0.3, 1]} c="#13363a" />
      <group ref={items}>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} castShadow>
            <boxGeometry args={[0.32, 0.42, 0.32]} />
            <meshStandardMaterial color="#f4f7f6" />
          </mesh>
        ))}
      </group>
      {/* signing station */}
      <Box p={[3.4, 2, 1.9]} s={[0.5, 0.25, 1.2]} c={C.mint} e={0.5} />
      <Box p={[3.4, 1.4, 1.35]} s={[0.12, 1, 0.12]} c="#13363a" />
      {/* open carton at the end of the belt */}
      <Carton p={[6.7, 0.55, 1.9]} />
    </group>
  );
}

function Carton({ p, glow }: { p: [number, number, number]; glow?: boolean }) {
  return (
    <group position={p}>
      <Box p={[0, 0, 0]} s={[1.1, 1.1, 1.1]} c={C.box} r={0.04} />
      <Box p={[0, 0.15, 0.56]} s={[0.42, 0.42, 0.02]} c={glow ? C.mint : "#f4f7f6"} e={glow ? 0.9 : 0} r={0.01} />
    </group>
  );
}

function Road() {
  const geo = useMemo(() => new THREE.TubeGeometry(ROAD, 120, 1.3, 2, false), []);
  const dashes = useMemo(() => Array.from({ length: 40 }, (_, i) => ROAD.getPointAt(i / 40)), []);
  return (
    <group>
      <mesh geometry={geo} scale={[1, 0.02, 1]} receiveShadow>
        <meshStandardMaterial color={C.road} />
      </mesh>
      {dashes.map((d, i) => (
        <mesh key={i} position={[d.x, 0.08, d.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 0.08]} />
          <meshBasicMaterial color={C.line} />
        </mesh>
      ))}
      {Array.from({ length: 14 }, (_, i) => <Tree key={i} p={[2 + i * 4.3, 0, i % 2 ? 9 : -6 - (i % 3)]} />)}
    </group>
  );
}

function Tree({ p }: { p: [number, number, number] }) {
  return (
    <group position={p}>
      <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[0.1, 0.14, 1]} /><meshStandardMaterial color="#5b4636" /></mesh>
      <mesh position={[0, 1.4, 0]} castShadow><coneGeometry args={[0.7, 1.6, 7]} /><meshStandardMaterial color={C.teal} flatShading /></mesh>
    </group>
  );
}

// The truck drives factory -> warehouse during section 3 and warehouse -> shop during section 5.
function Truck({ progress }: { progress: P }) {
  const g = useRef<THREE.Group>(null);
  const ping = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const f = clamp(progress.current) * (KEYS.length - 1);
    const leg1 = smooth(clamp((f - 2.2) / 1.6)) * 0.5;
    const leg2 = smooth(clamp((f - 4.2) / 1.0)) * 0.5;
    const u = clamp(leg1 + leg2, 0, 0.999);
    const p = ROAD.getPointAt(u);
    const tan = ROAD.getTangentAt(u);
    g.current?.position.set(p.x, 0, p.z);
    g.current?.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
    if (ping.current) {
      const t = (clock.elapsedTime * 0.8) % 1;
      ping.current.scale.setScalar(0.4 + t * 2.4);
      (ping.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t);
    }
  });
  return (
    <group ref={g}>
      <Box p={[-0.4, 1, 0]} s={[2.4, 1.4, 1.2]} c="#e7f4f2" />
      <Box p={[1.25, 0.8, 0]} s={[0.9, 1.05, 1.15]} c={C.amber} />
      <Box p={[1.58, 1, 0]} s={[0.25, 0.45, 1]} c={C.sea} e={0.4} r={0.02} />
      {[-1.1, 0.2, 1.3].flatMap((x) => [0.62, -0.62].map((z) => (
        <mesh key={x + ":" + z} position={[x, 0.3, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.3, 0.3, 0.2, 16]} /><meshStandardMaterial color="#111" /></mesh>
      )))}
      {/* GPS ping: every scan records where and when */}
      <mesh ref={ping} position={[-0.4, 2.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.45, 32]} />
        <meshBasicMaterial color={C.mint} transparent />
      </mesh>
      <mesh position={[-0.4, 2.2, 0]}><sphereGeometry args={[0.16, 16, 16]} /><meshStandardMaterial color={C.mint} emissive={C.mint} emissiveIntensity={1} /></mesh>
    </group>
  );
}

function Warehouse() {
  return (
    <group position={[30, 0, -1]}>
      <Box p={[0, 2, 0]} s={[9, 4, 5]} c={C.wall} />
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, 4.55, k * 1.25]} rotation={[k * 0.42, 0, 0]} castShadow>
          <boxGeometry args={[9.4, 0.18, 2.9]} />
          <meshStandardMaterial color={C.roof} />
        </mesh>
      ))}
      <Box p={[0, 1.5, 2.52]} s={[3, 3, 0.05]} c="#082024" r={0.02} />
      {/* pallet of cartons outside the door */}
      <group position={[-2.6, 0, 4]}>
        <Box p={[0, 0.1, 0]} s={[2.4, 0.2, 2.4]} c="#7a5c3e" r={0.02} />
        {[0, 1].flatMap((y) => [-0.55, 0.55].flatMap((x) => [-0.55, 0.55].map((z) => <Carton key={`${x}${y}${z}`} p={[x, 0.75 + y * 1.1, z]} />)))}
        <Float speed={2} floatIntensity={0.6}><Box p={[0, 3.4, 0]} s={[0.7, 0.7, 0.05]} c={C.mint} e={1} r={0.02} /></Float>
      </group>
      {/* the scan beam: one carton scan updates every item inside */}
      <Beam p={[-2.6, 2.6, 4]} />
    </group>
  );
}

function Beam({ p }: { p: [number, number, number] }) {
  const m = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (m.current) (m.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.12 * Math.sin(clock.elapsedTime * 3);
  });
  return (
    <mesh ref={m} position={p}>
      <boxGeometry args={[2.6, 2.6, 2.6]} />
      <meshBasicMaterial color={C.mint} transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

function Shop() {
  return (
    <group position={[60, 0, -1]}>
      <Box p={[0, 1.7, 0]} s={[7, 3.4, 4]} c="#163f44" />
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-3 + i, 3.15, 2.35]} rotation={[0.5, 0, 0]} castShadow>
          <boxGeometry args={[1, 0.08, 1.1]} />
          <meshStandardMaterial color={i % 2 ? C.amber : "#f4f7f6"} />
        </mesh>
      ))}
      <Box p={[0, 1.4, 2.02]} s={[4.6, 2, 0.05]} c={C.sea} e={0.35} r={0.02} />
      {/* shelves with items */}
      {[0.6, 1.4].flatMap((y) => Array.from({ length: 8 }, (_, i) => <Box key={y + ":" + i} p={[-2 + i * 0.55, y, 2.2]} s={[0.3, 0.4, 0.3]} c={i % 3 ? "#f4f7f6" : C.mint} r={0.03} />))}
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
  const tick = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (tick.current) tick.current.scale.setScalar(0.85 + 0.15 * Math.sin(clock.elapsedTime * 2.5));
  });
  return (
    <group position={[75, 2.6, 0]}>
      <Float speed={1.6} rotationIntensity={0.25} floatIntensity={0.6}>
        <Box p={[0, 0, 0]} s={[1.8, 3.4, 0.16]} c="#111" r={0.18} />
        <mesh position={[0, 0.25, 0.09]}>
          <planeGeometry args={[1.25, 1.25]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        <group ref={tick} position={[0, -1.05, 0.1]}>
          <mesh><circleGeometry args={[0.32, 32]} /><meshBasicMaterial color={C.mint} toneMapped={false} /></mesh>
        </group>
      </Float>
      {/* the product being scanned */}
      <Box p={[-1.8, -1.6, 0.6]} s={[0.7, 1, 0.7]} c="#f4f7f6" />
      <Box p={[-1.8, -1.4, 0.96]} s={[0.4, 0.4, 0.02]} c={C.mint} e={0.6} r={0.01} />
    </group>
  );
}

export default function Story({ progress }: { progress: P }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return (
    <Canvas shadows dpr={dpr} camera={{ position: KEYS[0][0], fov: 42, near: 0.1, far: 400 }} gl={{ antialias: true }}>
      <color attach="background" args={["#031b1e"]} />
      <fog attach="fog" args={["#031b1e", 40, 140]} />
      <hemisphereLight args={["#dff", "#134", 1.3]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[30, 40, 20]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <CameraRig progress={progress} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[36, 0, 0]} receiveShadow>
        <planeGeometry args={[220, 120]} />
        <meshStandardMaterial color={C.ground} />
      </mesh>
      <Factory />
      <Road />
      <Truck progress={progress} />
      <Warehouse />
      <Shop />
      <Phone />
      <ContactShadows position={[36, 0.01, 0]} scale={120} opacity={0.4} blur={2} far={10} />
    </Canvas>
  );
}
