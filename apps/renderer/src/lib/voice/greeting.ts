import { api } from "../runtime";

// "네, ○○님" 인사 TTS 결과를 메모리 캐시. 같은 이름·voice 조합이면 재호출 없이 즉시 반환.
// 디스크 캐시는 1.x로. 프로토타입은 in-memory만.
interface CacheEntry {
  name: string;
  voice: string;
  b64: string;
  mime: string;
}

let cache: CacheEntry | null = null;

function buildText(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? `네, ${trimmed}님` : "네, 부르셨나요";
}

export async function getGreeting(
  name: string,
  voice: string,
): Promise<{ b64: string; mime: string } | null> {
  if (cache && cache.name === name.trim() && cache.voice === voice) {
    return { b64: cache.b64, mime: cache.mime };
  }
  try {
    const text = buildText(name);
    const out = await api.ttsSpeak(text, voice);
    cache = {
      name: name.trim(),
      voice,
      b64: out.audio_b64,
      mime: out.mime,
    };
    return { b64: cache.b64, mime: cache.mime };
  } catch (e) {
    console.warn("[greeting] generation failed", e);
    return null;
  }
}

export function invalidateGreeting(): void {
  cache = null;
}
