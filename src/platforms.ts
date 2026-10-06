import info from "../electron/platform-info.json";

export type Platform = keyof typeof info;
export type ParticipationPlatform = Platform | "demo";
export const platforms = Object.keys(info) as Platform[];
export const platformLabel = (platform: Platform) => info[platform].label;
export const supportsDonation = (platform: Platform) => info[platform].donation;
