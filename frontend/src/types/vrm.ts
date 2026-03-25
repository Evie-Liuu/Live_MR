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
}

// ─── Scene Configuration ──────────────────────────────────────────────────────

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
  /** Floor grid: true = default 20×20, or explicit size/divisions */
  grid?: boolean | { size: number; divisions: number; color?: number };
  /** Default spawn for each avatar (by slot index, or a single fallback) */
  avatarDefaults?: AvatarSpawnConfig;
  /** Spacing between avatar slots (metres) */
  avatarSpacing?: number;
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
