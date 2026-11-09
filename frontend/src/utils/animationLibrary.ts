/**
 * animationLibrary.ts
 *
 * 動作檔（.vrma）依體型挑選：動作檔記錄的是關節角度，大人手臂比小孩長很多，
 * 同一組角度套到大人身上，手會伸過頭（例如揮手打到臉）。
 *
 * 規則：大人模型先找 `<名稱>.adult.vrma`，沒有就退回 `<名稱>.vrma`。
 * 所以只要把大人版動作檔放進 public/animations 就會自動生效，不用改程式；
 * 目前的動作檔是用小孩骨架做的，小孩模型直接用原檔。
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation';
import { VRM_SOURCES } from '../config/vrmSources.ts';
import type { BodyType } from '../types/vrm.ts';

export type { BodyType };

/** 沒有標記體型的模型當作小孩（與目前動作檔的骨架相同） */
export const DEFAULT_BODY_TYPE: BodyType = 'child';

/** 這個體型要優先找的動作檔網址；小孩直接用原檔 */
export function variantUrl(url: string, bodyType: BodyType): string {
  return bodyType === 'adult' ? url.replace(/\.vrma$/i, '.adult.vrma') : url;
}

/** 依模型網址查體型；不在模型清單（或沒標記）的當作小孩 */
export function bodyTypeOfVrmUrl(url: string | null | undefined): BodyType {
  if (!url) return DEFAULT_BODY_TYPE;
  return Object.values(VRM_SOURCES).find(s => s.url === url)?.bodyType ?? DEFAULT_BODY_TYPE;
}

type FetchAnimation = (url: string, optional: boolean) => Promise<VRMAnimation | null>;

/** 先找體型專用版，沒有就用原檔（給測試注入下載函式） */
export async function pickAnimation(url: string, bodyType: BodyType, fetchAnimation: FetchAnimation): Promise<VRMAnimation | null> {
  const preferred = variantUrl(url, bodyType);
  if (preferred !== url) {
    const variant = await fetchAnimation(preferred, true);
    if (variant) return variant;
  }
  return fetchAnimation(url, false);
}

const fileCache = new Map<string, Promise<VRMAnimation | null>>();

/**
 * 下載並解析一個動作檔，同一網址整個 app 只下載一次。
 * 不存在時開發伺服器會回 index.html（狀態仍是 200），所以也要看內容類型；
 * optional 的檔案（體型專用版）不存在是正常情況，不印警告。
 */
function fetchAnimationFile(url: string, optional: boolean): Promise<VRMAnimation | null> {
  let p = fileCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
          if (!optional) console.warn(`[animationLibrary] ${url} not found (${res.status})`);
          return null;
        }
        const loader = new GLTFLoader();
        loader.register(parser => new VRMAnimationLoaderPlugin(parser));
        const gltf = await loader.parseAsync(await res.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
        return (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0] ?? null;
      } catch (err) {
        console.warn(`[animationLibrary] ${url} load failed:`, err);
        return null;
      }
    })();
    fileCache.set(url, p);
  }
  return p;
}

/** 依體型載入動作檔；缺檔或載入失敗回傳 null */
export function loadAnimation(url: string, bodyType: BodyType = DEFAULT_BODY_TYPE): Promise<VRMAnimation | null> {
  return pickAnimation(url, bodyType, fetchAnimationFile);
}
