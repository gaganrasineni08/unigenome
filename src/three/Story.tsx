// The 3D centrepiece behind the home page: a neon ring road at night, modelled in Blender
// (scripts/blender/build_ring.py -> public/models/ring.glb). Four checkpoints sit on the ring
// (factory, warehouse, retailer, buyer) with the regulator's tower in the middle. As the page
// scrolls, a cargo hauler carrying a carton drives round the ring and is scanned at each arch,
// while the camera flies from shot to shot, banking on the turns.
//
// `chapter` comes from the page: 0 at the first section, 1 at the second, and so on, fractional
// in between. Every shot below is keyed to one chapter.
import { Html, MeshReflectorMaterial, Sparkles, Stars, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";

type P = MutableRefObject<number>;

const MODEL = "/models/ring.glb";
const R_ROAD = 32;
const R_CHECK = 48;
const COLORS = { factory: "#02C39A", warehouse: "#4FC3F7", retailer: "#E8A33D", buyer: "#8E7CC3", regulator: "#D96C6C" };
// Checkpoint angles (degrees, anticlockwise seen from above), as in the Blender script.
const CP = { factory: 210, warehouse: 300, retailer: 390, buyer: 480 } as const;
type CpKey = keyof typeof CP;
const CP_LIST = Object.keys(CP) as CpKey[];
const EVENTS: Record<CpKey, [string, string]> = {
  factory: ["Signed · packed · dispatched", "12 items sealed under one carton QR"],
  warehouse: ["Received at warehouse", "12 items updated by one scan"],
  retailer: ["Received · on the shelf", "carton opened, items tracked one by one"],
  buyer: ["Buyer scan: Genuine", "signature checked on the phone"],
};

// Where the hauler is (ring angle in degrees) at each chapter. It keeps driving after the buyer.
const TRUCK = [176, 203, 217, 255, 300, 390, 480, 520, 560];

// Blender's ring lies in its XY plane; on the page that is the XZ plane with z = -y.
const ring = (r: number, deg: number, y = 0, out = new THREE.Vector3()) => {
  const a = THREE.MathUtils.degToRad(deg);
  return out.set(r * Math.cos(a), y, -r * Math.sin(a));
};
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sample = (arr: number[], f: number) => {
  const i = Math.min(arr.length - 2, Math.max(0, Math.floor(f)));
  return THREE.MathUtils.lerp(arr[i], arr[i + 1], ease(clamp(f - i)));
};

// ---------------------------------------------------------------- camera shots
// Each shot returns [camera position, look-at point], given the hauler's position and heading and
// a slow clock so the camera keeps drifting while you read.
type Shot = (truck: THREE.Vector3, deg: number, t: number) => [THREE.Vector3, THREE.Vector3];
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const SHOTS: Shot[] = [
  (_, __, t) => [ring(125, 238 + t * 2.2, 78), v(0, 2, 0)], // 0 hero: the whole ring
  () => [ring(12, 186, 20), ring(R_CHECK, 210, 6)], // 1 factory, from inside the ring
  (tr, d) => [ring(R_ROAD - 16, d + 3, 7.5), tr.clone().setY(2.6)], // 2 carton QR close-up beside the hauler
  (tr, d) => [ring(R_ROAD - 3, d - 24, 12), ring(R_ROAD, d + 12, 2)], // 3 chase, behind and above
  () => [ring(10, 280, 20), ring(R_CHECK, 300, 5)], // 4 warehouse
  () => [ring(6, 6, 22), ring(R_CHECK, 30, 7)], // 5 retailer
  () => [ring(22, 114, 14), ring(R_CHECK, 120, 9)], // 6 the giant phone, looking over its arch
  (_, __, t) => [ring(58, 150 + t * 3, 46), v(0, 22, 0)], // 7 the regulator's tower
  (_, __, t) => [ring(200, 210 + t * 1.5, 135), v(0, 0, 0)], // 8 pull back for the portals
];

function CameraRig({ chapter, truckState }: { chapter: P; truckState: MutableRefObject<{ pos: THREE.Vector3; deg: number }> }) {
  const { camera, size } = useThree();
  const st = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), vel: new THREE.Vector3(), roll: 0, view: "", init: false }), []);
  const a = useMemo(() => [new THREE.Vector3(), new THREE.Vector3()], []);
  const reduced = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  useFrame(({ clock }, dt) => {
    dt = Math.min(dt, 0.1);
    const t = reduced ? 0 : clock.elapsedTime;
    const f = clamp(chapter.current, 0, SHOTS.length - 1);
    const i = Math.min(SHOTS.length - 2, Math.floor(f));
    const k = ease(f - i);
    const { pos: tp, deg } = truckState.current;
    const [p0, l0] = SHOTS[i](tp, deg, t);
    const [p1, l1] = SHOTS[i + 1](tp, deg, t);
    a[0].copy(p0).lerp(p1, k);
    a[1].copy(l0).lerp(l1, k);
    // Mid-flight, lift the camera so it arcs over the scene instead of cutting through buildings.
    a[0].y += Math.sin(Math.PI * k) * 10;
    // Portrait screens see less width: back off along the view line.
    const aspect = size.width / size.height;
    if (aspect < 1.2) a[0].sub(a[1]).multiplyScalar(Math.min(2, 1.15 / aspect)).add(a[1]);
    if (!st.init) {
      st.pos.copy(a[0]);
      st.look.copy(a[1]);
      st.init = true;
    }
    const prev = camera.position.clone();
    const damp = 1 - Math.exp(-dt * 3.2);
    st.pos.lerp(a[0], damp);
    st.look.lerp(a[1], damp);
    camera.position.copy(st.pos);
    camera.lookAt(st.look);
    // Bank into sideways motion, like a camera on a drone.
    st.vel.subVectors(camera.position, prev).divideScalar(Math.max(dt, 1e-3));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const target = reduced ? 0 : clamp(-st.vel.dot(right) * 0.006, -0.16, 0.16);
    st.roll += (target - st.roll) * (1 - Math.exp(-dt * 2.5));
    camera.rotateZ(st.roll);
    // The story card covers part of the screen: the left side on wide screens, the bottom on phones.
    // Frame the subject beside it by rendering part of a larger view. The portals chapter centres it.
    const shift = 0.34 * (1 - clamp(f - (SHOTS.length - 2)));
    const wide = aspect > 1.2;
    const key = `${size.width}x${size.height}:${wide}:${shift.toFixed(3)}`;
    if (key !== st.view) {
      st.view = key;
      const cam = camera as THREE.PerspectiveCamera;
      if (shift < 1e-3) cam.clearViewOffset();
      else if (wide) cam.setViewOffset(Math.round(size.width * (1 + shift)), size.height, 0, 0, size.width, size.height);
      else cam.setViewOffset(size.width, Math.round(size.height * (1 + shift)), 0, Math.round(size.height * shift), size.width, size.height);
    }
  });
  return null;
}

// ---------------------------------------------------------------- textures drawn on canvases

function qrTexture(text: string, fg: string, bg: string, label?: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 512);
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const top = label ? 40 : 56;
  const cell = Math.floor((label ? 380 : 400) / n);
  const x0 = (512 - cell * n) / 2;
  g.fillStyle = fg;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) g.fillRect(x0 + x * cell, top + y * cell, cell, cell);
  if (label) {
    g.font = "bold 44px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(label, 256, 488);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false; // glTF UVs start at the top-left
  return t;
}

function phoneTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 1024;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, "#1b1440");
  grad.addColorStop(1, "#06121a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 1024);
  // verdict badge
  g.fillStyle = "rgba(2,195,154,0.18)";
  g.beginPath();
  g.arc(256, 190, 92, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#02C39A";
  g.lineWidth = 18;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(212, 192);
  g.lineTo(246, 226);
  g.lineTo(306, 160);
  g.stroke();
  g.fillStyle = "#02C39A";
  g.font = "bold 72px Fraunces, Georgia, serif";
  g.textAlign = "center";
  g.fillText("Genuine", 256, 360);
  g.fillStyle = "#c9d6e8";
  g.font = "28px Inter, system-ui, sans-serif";
  g.fillText("Signed · registered · history checks out", 256, 410);
  // a mini QR card
  g.fillStyle = "#ffffff";
  g.fillRect(126, 470, 260, 260);
  const qr = QRCode.create("UNIGENOME:B-1188-003", { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = Math.floor(230 / n);
  const x0 = 126 + (260 - cell * n) / 2;
  g.fillStyle = "#0b1020";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) g.fillRect(x0 + x * cell, 470 + (260 - cell * n) / 2 + y * cell, cell, cell);
  // journey dots
  const stops = ["#02C39A", "#4FC3F7", "#E8A33D", "#8E7CC3"];
  stops.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(116 + i * 93, 820, 16, 0, Math.PI * 2);
    g.fill();
    if (i < 3) g.fillRect(132 + i * 93, 817, 61, 6);
  });
  g.fillStyle = "#8fa3b8";
  g.font = "24px Inter, system-ui, sans-serif";
  g.fillText("Factory → Warehouse → Shop → You", 256, 880);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false; // glTF UVs start at the top-left
  return t;
}

// ---------------------------------------------------------------- the model and its moving parts

function World({ chapter, truckState }: { chapter: P; truckState: MutableRefObject<{ pos: THREE.Vector3; deg: number }> }) {
  const { scene } = useGLTF(MODEL);
  const parts = useMemo(() => {
    const get = (n: string) => scene.getObjectByName(n)!;
    // Live textures for the carton QR and the phone's screen.
    const carton = qrTexture("UNIGENOME:C-A060F6", "#111111", "#f4efe6", "C-A060F6");
    // The far side's face is wound the other way, so its copy of the texture is mirrored back.
    const mirrored = carton.clone();
    mirrored.wrapS = THREE.RepeatWrapping;
    mirrored.repeat.x = -1;
    for (const [n, tex] of [["CartonQR_a", carton], ["CartonQR_b", mirrored]] as const) {
      const m = get(n) as THREE.Mesh;
      m.material = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.35, roughness: 0.7, side: THREE.DoubleSide });
    }
    const screen = phoneTexture();
    (get("PhoneScreen") as THREE.Mesh).material = new THREE.MeshBasicMaterial({ map: screen, toneMapped: false, side: THREE.DoubleSide });
    return { hauler: get("Hauler"), haloA: get("Halo_a"), haloB: get("Halo_b"), spin: get("Retailer_spin"), beacon: get("Regulator_beacon") as THREE.Mesh };
  }, [scene]);

  const st = useMemo(() => ({ deg: TRUCK[0], speed: 0 }), []);
  useFrame(({ clock }, dt) => {
    dt = Math.min(dt, 0.1);
    const t = clock.elapsedTime;
    const goal = sample(TRUCK, clamp(chapter.current, 0, TRUCK.length - 1));
    const before = st.deg;
    st.deg += (goal - st.deg) * (1 - Math.exp(-dt * 2.4));
    st.speed = (st.deg - before) / Math.max(dt, 1e-3);
    const h = parts.hauler;
    ring(R_ROAD, st.deg, 0.35 + Math.sin(t * 9) * 0.015 * Math.min(1, Math.abs(st.speed)), h.position);
    // Face along the road (anticlockwise), leaning a touch into the curve when moving.
    h.rotation.set(0, THREE.MathUtils.degToRad(st.deg) + Math.PI / 2, 0);
    h.rotateX(clamp(st.speed * 0.004, -0.06, 0.06));
    truckState.current.pos.copy(h.position);
    truckState.current.deg = st.deg;
    parts.haloA.rotation.y = t * 0.35;
    parts.haloB.rotation.y = -t * 0.22;
    parts.haloA.position.y = 26 + Math.sin(t * 0.8) * 0.6;
    parts.spin.rotateOnWorldAxis(UP, dt * 0.9);
    const bm = parts.beacon.material as THREE.MeshStandardMaterial;
    bm.emissiveIntensity = 10 + 22 * Math.max(0, Math.sin(t * 3.2));
  });

  return (
    <>
      <primitive object={scene} />
      <HaulerGlow truckState={truckState} />
      {CP_LIST.map((k) => (
        <Scanner key={k} cp={k} truckState={truckState} />
      ))}
      <GraphEdges truckState={truckState} />
    </>
  );
}

/** A cyan light riding under the hauler so it washes the wet road. */
function HaulerGlow({ truckState }: { truckState: MutableRefObject<{ pos: THREE.Vector3; deg: number }> }) {
  const l = useRef<THREE.PointLight>(null);
  const h = useRef<THREE.PointLight>(null);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const { pos, deg } = truckState.current;
    l.current?.position.copy(pos).setY(0.9);
    const a = THREE.MathUtils.degToRad(deg);
    fwd.set(-Math.sin(a), 0, -Math.cos(a));
    h.current?.position.copy(pos).addScaledVector(fwd, 9).setY(1.6);
  });
  return (
    <>
      <pointLight ref={l} color="#4FC3F7" intensity={25} distance={12} decay={2} />
      <pointLight ref={h} color="#fff4e0" intensity={30} distance={18} decay={2} />
    </>
  );
}

/** The arch's scan beam and the event card that pops up while the hauler passes through. */
function Scanner({ cp, truckState }: { cp: CpKey; truckState: MutableRefObject<{ pos: THREE.Vector3; deg: number }> }) {
  const beam = useRef<THREE.Mesh>(null);
  const sheet = useRef<THREE.Mesh>(null);
  const [on, setOn] = useState(false);
  const deg = CP[cp];
  const color = COLORS[cp];
  const pos = useMemo(() => ring(R_ROAD, deg, 0), [deg]);
  const rotY = THREE.MathUtils.degToRad(deg);
  useFrame(({ clock }) => {
    const d = truckState.current.deg - deg;
    const near = Math.abs(d) < 7;
    const k = clamp(1 - Math.abs(d) / 9);
    const flick = 0.75 + 0.25 * Math.sin(clock.elapsedTime * 30);
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.5 * k * flick;
    if (sheet.current) {
      (sheet.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * k;
      sheet.current.position.y = 0.6 + ((clock.elapsedTime * 3.2) % 6.6);
    }
    if (near !== on) setOn(near);
  });
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* the cone of light under the scanner head */}
      <mesh ref={beam} position={[0, 3.9, 0]}>
        <cylinderGeometry args={[0.9, 5.2, 7.4, 4, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* a bright sheet sweeping up and down while scanning */}
      <mesh ref={sheet} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8.6, 0.25]} />
        <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <Html position={[0, 11.5, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className={`lg-chip ${on ? "is-on" : ""}`} style={{ ["--chip" as string]: color }}>
          <span className="lg-chip-dot" />
          <div>
            <div className="lg-chip-title">{EVENTS[cp][0]}</div>
            <div className="lg-chip-sub">{EVENTS[cp][1]}</div>
          </div>
        </div>
      </Html>
    </group>
  );
}

/** Light pulses from the regulator's tower to every checkpoint: the supply chain as a graph. */
function GraphEdges({ truckState }: { truckState: MutableRefObject<{ pos: THREE.Vector3; deg: number }> }) {
  const edges = useMemo(
    () =>
      CP_LIST.map((k) => {
        const from = new THREE.Vector3(0, 29, 0);
        const to = ring(R_CHECK, CP[k], k === "buyer" ? 16 : 10);
        const curve = new THREE.QuadraticBezierCurve3(from, from.clone().lerp(to, 0.5).setY(34), to);
        return { k, curve, geo: new THREE.TubeGeometry(curve, 48, 0.06, 6, false) };
      }),
    [],
  );
  const pulses = useRef<Array<THREE.Mesh | null>>([]);
  const lines = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    edges.forEach((e, i) => {
      const u = (t * 0.35 + i * 0.25) % 1;
      pulses.current[i]?.position.copy(e.curve.getPoint(u));
      const active = Math.abs(truckState.current.deg - CP[e.k]) < 12;
      const m = lines.current[i]?.material as THREE.MeshBasicMaterial | undefined;
      if (m) m.opacity += ((active ? 0.95 : 0.28) - m.opacity) * 0.08;
    });
  });
  return (
    <group>
      {edges.map((e, i) => (
        <group key={e.k}>
          <mesh ref={(m) => void (lines.current[i] = m)} geometry={e.geo}>
            <meshBasicMaterial color={COLORS[e.k]} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
          <mesh ref={(m) => void (pulses.current[i] = m)}>
            <sphereGeometry args={[0.32, 12, 12]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Labels({ chapter }: { chapter: P }) {
  const items: Array<[string, string, THREE.Vector3]> = [
    ["Factory", COLORS.factory, ring(R_CHECK + 3, CP.factory, 24)],
    ["Warehouse", COLORS.warehouse, ring(R_CHECK + 3, CP.warehouse, 16)],
    ["Retailer", COLORS.retailer, ring(R_CHECK + 3, CP.retailer, 17)],
    ["Buyer", COLORS.buyer, ring(R_CHECK + 1, CP.buyer, 20)],
    ["Regulator", COLORS.regulator, new THREE.Vector3(0, 44, 0)],
  ];
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  // Hide the floating labels once the portal cards scroll in on top of the scene.
  useFrame(() => {
    const o = String(clamp(1 - (chapter.current - (SHOTS.length - 2)) * 2));
    refs.current.forEach((el) => el && el.style.opacity !== o && (el.style.opacity = o));
  });
  return (
    <>
      {items.map(([name, c, p], i) => (
        <Html key={name} position={p} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => void (refs.current[i] = el)} className="lg-tag" style={{ ["--chip" as string]: c }}>{name}</div>
        </Html>
      ))}
    </>
  );
}

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color("#01040a") }, mid: { value: new THREE.Color("#04161f") }, glow: { value: new THREE.Color("#0f4a55") } },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 mid; uniform vec3 glow; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(mid, top, pow(h, 0.55)); c += glow * pow(1.0 - h, 6.0) * 0.9; gl_FragColor = vec4(c, 1.0); }",
      }),
    [],
  );
  return (
    <mesh material={mat}>
      <sphereGeometry args={[480, 32, 16]} />
    </mesh>
  );
}

function Ground({ low }: { low: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <circleGeometry args={[420, 64]} />
      <MeshReflectorMaterial
        blur={[400, 120]}
        resolution={low ? 512 : 1024}
        mixBlur={1}
        mixStrength={28}
        roughness={0.85}
        depthScale={1.1}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.4}
        color="#03070b"
        metalness={0.6}
        mirror={0.6}
      />
    </mesh>
  );
}

export default function Story({ progress }: { progress: P }) {
  const low = useMemo(() => Math.min(innerWidth, innerHeight) < 700, []);
  const dpr = Math.min(low ? 1.5 : 1.75, window.devicePixelRatio || 1);
  const truckState = useRef({ pos: new THREE.Vector3(), deg: TRUCK[0] });
  useEffect(() => () => useGLTF.clear(MODEL), []);
  return (
    <Canvas dpr={dpr} camera={{ position: [80, 60, 60], fov: 42, near: 0.5, far: 1200 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <color attach="background" args={["#01040a"]} />
      <fog attach="fog" args={["#04121a", 120, 420]} />
      <Sky />
      <Stars radius={300} depth={80} count={low ? 1500 : 4000} factor={6} saturation={0.4} fade speed={0.6} />
      <ambientLight intensity={0.25} />
      <hemisphereLight args={["#5aa7c8", "#05080c", 0.4]} />
      <directionalLight position={[-60, 90, 40]} intensity={1.1} color="#9fc8ff" />
      <World chapter={progress} truckState={truckState} />
      <Labels chapter={progress} />
      <Sparkles count={low ? 60 : 160} scale={[120, 30, 120]} position={[0, 14, 0]} size={3} speed={0.3} opacity={0.5} color="#9ff0e0" />
      <Ground low={low} />
      <CameraRig chapter={progress} truckState={truckState} />
      <EffectComposer multisampling={low ? 0 : 4}>
        <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.62} luminanceSmoothing={0.3} />
        <Vignette eskil={false} offset={0.2} darkness={0.7} />
      </EffectComposer>
    </Canvas>
  );
}

useGLTF.preload(MODEL);
