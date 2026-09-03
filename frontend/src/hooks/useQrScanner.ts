import { useCallback, useRef } from 'react';
import QrScanner from 'qr-scanner';

// 注意：qr-scanner 1.4.x 已不需要（也不支援）手動設定 QrScanner.WORKER_PATH——
// 它會透過真正的動態 import() 載入 worker 檔案，Vite 等現代 bundler 能自動處理，
// 手動設定該屬性只會印出 deprecation 警告，因此這裡刻意不設。
// （若原生 BarcodeDetector 可用，套件會優先使用它加速解碼；不可用時──包含 Safari/iOS──
// 會自動退回這個 WebWorker/WASM 解碼器，因此不會有 iOS 相容性問題。）

interface UseQrScannerOptions {
  onDecode: (text: string) => void;
  onError: (message: string) => void;
}

export interface UseQrScannerResult {
  start: (video: HTMLVideoElement) => Promise<void>;
  stop: () => void;
}

/**
 * 包裝 qr-scanner 套件：開啟指定 <video> 元素的鏡頭，持續解碼畫面中的 QR Code。
 * onDecode/onError 存進 ref 而非直接放進 useCallback 依賴，讓 start/stop 的函式
 * 參考維持穩定——呼叫端（StudentHome）每次 render 都會傳新的 inline callback 進來，
 * 若把它們列進依賴陣列，start/stop 每次 render 都會變成新函式，觸發呼叫端的
 * useEffect 重跑、鏡頭被重開。
 */
export function useQrScanner({ onDecode, onError }: UseQrScannerOptions): UseQrScannerResult {
  const scannerRef = useRef<QrScanner | null>(null);
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);
  onDecodeRef.current = onDecode;
  onErrorRef.current = onError;

  const stop = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
  }, []);

  const start = useCallback(async (video: HTMLVideoElement) => {
    stop();
    try {
      const scanner = new QrScanner(
        video,
        (result) => onDecodeRef.current(result.data),
        {
          preferredCamera: 'environment',
          highlightScanRegion: false,
          highlightCodeOutline: false,
        },
      );
      scannerRef.current = scanner;
      await scanner.start();
    } catch (err) {
      onErrorRef.current('無法開啟相機，請確認已授權相機權限');
      console.error('[useQrScanner] Failed to start camera:', err);
    }
  }, [stop]);

  return { start, stop };
}
