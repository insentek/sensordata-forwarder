export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const unixSecondsToIso = (timestamp: number): string =>
  new Date(timestamp * 1000).toISOString();
