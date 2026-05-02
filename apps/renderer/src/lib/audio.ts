export interface PlayHandle {
  audio: HTMLAudioElement;
  stop: () => void;
}

export async function playBase64(
  base64: string,
  mime = "audio/mpeg",
): Promise<PlayHandle> {
  const bytes = base64ToBytes(base64);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  audio.addEventListener("error", () => URL.revokeObjectURL(url));
  await audio.play();
  return {
    audio,
    stop: () => {
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      audio.src = "";
      URL.revokeObjectURL(url);
    },
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
