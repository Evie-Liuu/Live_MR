// ─── Shared VRM / Pose Types ─────────────────────────────────────────────────

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface FaceBlendshapes {
  [category: string]: number;
}

export interface PoseFrame {
  type: 'pose';
  landmarks: PoseLandmark[];
  worldLandmarks: PoseLandmark[];
  /** Face blendshapes from FaceLandmarker (optional, present when face detection enabled) */
  faceBlendshapes?: FaceBlendshapes;
  /** Face landmarks for Kalidokit Face.solve */
  faceLandmarks?: PoseLandmark[];
  /** 21 hand landmarks from MediaPipe HandLandmarker (person's left hand) */
  leftHandLandmarks?: PoseLandmark[];
  /** 21 hand landmarks from MediaPipe HandLandmarker (person's right hand) */
  rightHandLandmarks?: PoseLandmark[];
}

// ─── Scene Configuration ──────────────────────────────────────────────────────

/** A named, fixed position within a scene for a participant */
export interface SceneSlot {
  id: string;                                    // e.g. 'cashier', 'customer'
  label: string;                                 // display name e.g. '收銀員'
  icon?: string;                                 // optional emoji for console UI e.g. '🏪'
  position: [x: number, y: number, z: number];  // world-space position on BigScreen
  rotation?: [x: number, y: number, z: number]; // euler rotation (radians); y used to face partner
  defaultVrmId?: string;                         // suggested VRM for this slot
}

/** Camera preset: where the Three.js PerspectiveCamera sits */
export interface CameraConfig {
  fov: number;
  position: [x: number, y: number, z: number];
  lookAt: [x: number, y: number, z: number];
  near?: number;
  far?: number;
}

/** A directional or ambient light descriptor */
export interface LightConfig {
  type: 'ambient' | 'directional';
  color?: number;
  intensity: number;
  position?: [x: number, y: number, z: number];
  target?: [x: number, y: number, z: number];
}

/** Per-avatar spawn settings (applied after VRM load) */
export interface AvatarSpawnConfig {
  /** world-space position offset for this avatar slot */
  position?: [x: number, y: number, z: number];
  /** euler rotation (radians) applied to vrm.scene */
  rotation?: [x: number, y: number, z: number];
  /** uniform scale */
  scale?: number;
}

/** Full scene preset definition */
export interface SceneConfig {
  id: string;
  label: string;
  camera: CameraConfig;
  lights: LightConfig[];
  /** Layered background type: render as child of a DOM container under the canvas */
  backgroundType?: 'image' | 'video' | 'camera' | 'color' | 'none';
  /** Value for the background: URL for image/video, or CSS color string for color */
  backgroundValue?: string;
  /** Replay interval for video backgrounds (seconds). If set, video will wait this long before looping. */
  videoLoopInterval?: number;
  /** Floor grid: true = default 20×20, or explicit size/divisions */
  grid?: boolean | { size: number; divisions: number; color?: number };
  /** Restricted list of allowed VRM source IDs for this scene. If undefined, all are allowed. */
  allowedVrmIds?: string[];
  /** Default spawn for each avatar (by slot index, or a single fallback) */
  avatarDefaults?: AvatarSpawnConfig;
  /** Spacing between avatar slots (metres) */
  avatarSpacing?: number;
  /** Named, fixed positions for participants in this scene (enables slot-assignment mode) */
  slots?: SceneSlot[];
  /** Optional teaching modules for this scene (Module → TaskItems hierarchy) */
  modules?: SceneModule[];
  /** Scene prop system: static props + task prop registry */
  propSystem?: ScenePropSystem;
}

// ─── Teaching Hierarchy ──────────────────────────────────────────────────────

/** Actual practice task, shown as a pill inside a Module */
export interface TaskItem {
  id: string;
  label: string; // e.g. "Ask for the price of a blue T-shirt."
}

/** A grouping of related tasks (教學功能層) */
export interface SceneModule {
  id: string;
  label: string;  // e.g. "Ask for a Price"
  icon?: string;  // optional emoji
  tasks: TaskItem[];
}

/** Static scene prop: always visible when the scene is loaded */
export interface PropConfig {
  id: string;
  url: string;                                    // GLB path e.g. '/models/cashier_counter.glb'
  position: [x: number, y: number, z: number];
  rotation?: [x: number, y: number, z: number];  // Euler radians
  scale?: number;                                 // uniform scale, default 1.0
}

/** Task-associated prop: pre-loaded at scene start, placed at world-space coords */
export interface TaskPropConfig {
  url: string;
  displayPos: [x: number, y: number, z: number];
  rotation?: [x: number, y: number, z: number];
  scale?: number;
}

/** Prop system config attached to a scene */
export interface ScenePropSystem {
  /** Visibility policy for task props — reserved for Phase 2. Default: 'auto-swap' */
  policy?: 'auto-swap' | 'accumulate' | 'manual';
  /** Always-visible props loaded with the scene */
  staticProps?: PropConfig[];
  /** Task prop registry: task ID → prop config (all pre-loaded, all visible) */
  taskProps?: Record<string, TaskPropConfig>;
}

/** A sub-scene within a Theme (e.g. 收銀台, 試衣間) */
export interface SceneVariant {
  id: string;
  label: string;
  icon?: string;
  /** Fixed participant positions for THIS scene variant */
  slots?: SceneSlot[];
  /** Restricted VRM model IDs for this variant (overrides Theme-level if set) */
  allowedVrmIds?: string[];
  /** Teaching modules for this variant */
  modules?: SceneModule[];
  /** Scene prop system: static props + task prop registry */
  propSystem?: ScenePropSystem;
}

/** Top-level teaching theme (e.g. 服飾店) */
export interface ThemeConfig {
  id: string;
  label: string;
  icon?: string;
  scenes: SceneVariant[];
}

// ─── VRM Source Configuration ─────────────────────────────────────────────────

/** A single VRM model source entry */
export interface VrmSource {
  id: string;
  label: string;
  /** URL path to the .vrm file */
  url: string;
}

/** Registry of all available VRM sources */
export type VrmSourceRegistry = Record<string, VrmSource>;
