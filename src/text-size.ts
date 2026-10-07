import { useLayoutEffect, useState } from "react";
export const textScaleEvent = "assist:text-scale";
export const currentTextScale = () => Number(document.documentElement.style.getPropertyValue("--text-scale")) || 1;
export function useTextScale() {
  const [scale, setScale] = useState(currentTextScale);
  useLayoutEffect(() => {
    const update = () => setScale(currentTextScale());
    update(); window.addEventListener(textScaleEvent, update);
    return () => window.removeEventListener(textScaleEvent, update);
  }, []);
  return scale;
}
