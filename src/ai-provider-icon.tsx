import { Icon } from "./icons";
import openai from "./assets/ai/openai.svg";
import anthropic from "./assets/ai/anthropic.svg";
import xai from "./assets/ai/xai.svg";
import google from "./assets/ai/google.svg";
import deepseek from "./assets/ai/deepseek.svg";
import moonshot from "./assets/ai/moonshot.svg";

const logos: Record<string, { src: string; monochrome: boolean }> = {
  openai: { src: openai, monochrome: true },
  anthropic: { src: anthropic, monochrome: true },
  xai: { src: xai, monochrome: true },
  google: { src: google, monochrome: false },
  deepseek: { src: deepseek, monochrome: false },
  moonshot: { src: moonshot, monochrome: true },
};

export function AiProviderIcon({ providerId, size = 20 }: {
  providerId: string;
  size?: number;
}) {
  const logo = Object.hasOwn(logos, providerId) ? logos[providerId] : undefined;
  return (
    <span className="ai-provider-logo" data-ai-provider={providerId} aria-hidden="true">
      {logo ? (
        <img
          className={"ai-provider-icon" + (logo.monochrome ? " monochrome" : "")}
          src={logo.src}
          width={size}
          height={size}
          alt=""
          draggable={false}
        />
      ) : <Icon name="link" size={size} />}
    </span>
  );
}
