let pdfjsPromise: Promise<any> | null = null;

export function loadPdfJs(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = new Promise((resolve, reject) => {
    if (w.pdfjsLib) {
      resolve(w.pdfjsLib);
      return;
    }
    const existing = document.querySelector('script[src*="pdf.min.js"]') as HTMLScriptElement | null;
    const initWorker = () => {
      if (w.pdfjsLib) {
        w.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(w.pdfjsLib);
      } else {
        reject(new Error("pdfjsLib not found on window"));
      }
    };
    if (existing) {
      existing.addEventListener("load", initWorker);
      existing.addEventListener("error", (err) => {
        pdfjsPromise = null;
        reject(err);
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.async = true;
    script.onload = initWorker;
    script.onerror = (err) => {
      pdfjsPromise = null;
      reject(err);
    };
    document.head.appendChild(script);
  });

  return pdfjsPromise;
}
