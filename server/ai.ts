import fs from 'fs';
import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import type {
  ClipMoment,
  MomentCategory,
  TranscriptSegment,
  WordToken,
} from '../src/types/clip.ts';

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientAIError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  );
}

function formatCleanAIError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // not JSON
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return 'AI service is temporarily busy. Please try again in a few seconds.';
  }
  return raw;
}

async function withAITimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('503 AI request timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateWithFallback(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, 'model'>,
  primaryModel: string,
  fallbackModel?: string
): Promise<GenerateContentResponse> {
  const modelsToTry = fallbackModel ? [primaryModel, fallbackModel] : [primaryModel];
  let lastError: unknown;

  for (const model of modelsToTry) {
    const isFallback = model !== primaryModel;
    const attemptTimeoutMs = isFallback ? 12000 : 10000;
    const maxAttempts = isFallback ? 2 : 1;
    const effectiveConfig = isFallback && params.config
      ? { ...params.config, thinkingConfig: undefined }
      : params.config;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await withAITimeout(
          ai.models.generateContent({
            ...params,
            config: effectiveConfig,
            model,
          }),
          attemptTimeoutMs
        );
      } catch (err) {
        lastError = err;
        console.warn(`[ClipKaro AI] model=${model} attempt=${attempt + 1} error:`, err instanceof Error ? err.message : err);
        if (!isTransientAIError(err)) {
          throw new Error(formatCleanAIError(err));
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }

  throw new Error(formatCleanAIError(lastError));
}

const VALID_CATEGORIES = [
  'Funny Moments',
  'Adventure Moments',
  'Emotional Moments',
  'Action Moments',
  'Motivational Moments',
] as const;

type SpecificCategory = (typeof VALID_CATEGORIES)[number];

function normalizeCategory(raw: string, fallback: MomentCategory): SpecificCategory {
  const lower = raw.toLowerCase();
  if (lower.includes('funny') || lower.includes('comedy')) return 'Funny Moments';
  if (lower.includes('adventure') || lower.includes('travel')) return 'Adventure Moments';
  if (lower.includes('emotion') || lower.includes('heart')) return 'Emotional Moments';
  if (lower.includes('action') || lower.includes('thrill')) return 'Action Moments';
  if (lower.includes('motiv') || lower.includes('inspir')) return 'Motivational Moments';
  if (fallback !== 'All Viral Moments') return fallback;
  return 'Motivational Moments';
}

/**
 * Transcribes spoken audio using Whisper-equivalent speech transcription (gemini-3.5-transcribe)
 * and extracts timed transcript segments + detected language via gemini-4-hydrogen (with gemini-3.1-flash-lite fallback).
 */
export async function transcribeAudioFile(
  audioPath: string,
  totalDuration: number
): Promise<{
  detectedLanguage: string;
  segments: TranscriptSegment[];
}> {
  const ai = getAIClient();
  const audioBuffer = fs.readFileSync(audioPath);

  if (audioBuffer.byteLength > 14 * 1024 * 1024) {
    throw new Error('Audio track exceeds maximum single-pass transcription size (14MB).');
  }

  const base64Audio = audioBuffer.toString('base64');

  // Step 1: High-accuracy speech transcription with gemini-3.5-transcribe
  let rawTranscript = '';
  try {
    const transcribeRes = await generateWithFallback(
      ai,
      {
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/mp3',
                data: base64Audio,
              },
            },
            {
              text: 'Transcribe all spoken speech verbatim in its natural language (Hindi, Hinglish, English, Punjabi, etc.). Preserve exact spoken words.',
            },
          ],
        },
      },
      'gemini-3.5-transcribe'
    );
    rawTranscript = (transcribeRes.text ?? '').trim();
  } catch {
    // Proceed directly with multimodal audio timestamping
  }

  // Step 2: Timestamped segment alignment & language detection
  const response = await generateWithFallback(
    ai,
    {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: base64Audio,
            },
          },
          {
            text: `Listen closely to this ${Math.round(totalDuration)}s audio track.${
              rawTranscript ? `\nReference verbatim transcript:\n${rawTranscript}\n` : ''
            }
Detect the primary spoken language (e.g., "Hinglish", "Hindi", "English", "Punjabi", or another detected language).
Break the spoken dialogue into accurate timestamped subtitle phrases between 0 and ${totalDuration.toFixed(1)} seconds.
Keep each phrase short (3-8 words) with accurate start and end timestamps in seconds.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: {
              type: Type.STRING,
              description: 'Detected spoken language such as Hindi, Hinglish, English, or Punjabi.',
            },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                },
                required: ['text', 'start', 'end'],
              },
            },
          },
          required: ['detectedLanguage', 'segments'],
        },
      },
    },
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite'
  );

  const parsed = JSON.parse(response.text ?? '{}') as {
    detectedLanguage?: string;
    segments?: Array<{ text?: string; start?: number; end?: number }>;
  };

  const segments: TranscriptSegment[] = (parsed.segments ?? [])
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s) => {
      const start = Math.max(0, Math.min(totalDuration - 0.5, Number(s.start ?? 0)));
      const end = Math.max(start + 0.4, Math.min(totalDuration, Number(s.end ?? start + 2)));
      return {
        text: s.text!.trim(),
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
      };
    });

  return {
    detectedLanguage: parsed.detectedLanguage?.trim() || 'English',
    segments,
  };
}

/**
 * Generates word-by-word tokens from timed transcript segments inside [startTime, endTime].
 */
function buildWordTokensFromSegments(
  segments: TranscriptSegment[],
  startTime: number,
  endTime: number
): WordToken[] {
  const overlapping = segments.filter((s) => s.end > startTime && s.start < endTime);
  const tokens: WordToken[] = [];
  let counter = 0;

  for (const seg of overlapping) {
    const segStart = Math.max(startTime, seg.start);
    const segEnd = Math.min(endTime, seg.end);
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const span = Math.max(0.25, segEnd - segStart);
    const totalChars = words.reduce((acc, w) => acc + Math.max(2, w.length), 0);
    let cursor = segStart;

    for (const w of words) {
      const weight = Math.max(2, w.length) / totalChars;
      const wordDur = Math.max(0.12, span * weight);
      const tokenEnd = Math.min(segEnd, cursor + wordDur);
      tokens.push({
        id: `w-${++counter}`,
        word: w,
        start: Number(cursor.toFixed(2)),
        end: Number(Math.max(cursor + 0.1, tokenEnd).toFixed(2)),
      });
      cursor = tokenEnd;
    }
  }

  return tokens;
}

export async function detectClipMoments(params: {
  title: string;
  channel: string;
  duration: number;
  transcriptSegments: TranscriptSegment[];
  detectedLanguage: string;
  category: MomentCategory;
  targetDuration: number;
}): Promise<{
  detectedLanguage: string;
  moments: ClipMoment[];
}> {
  const ai = getAIClient();
  const safeDuration = Math.max(10, params.duration);
  const clampedTarget = Math.max(5, Math.min(safeDuration, params.targetDuration));

  const transcriptText =
    params.transcriptSegments.length > 0
      ? params.transcriptSegments
          .slice(0, 350)
          .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.text}`)
          .join('\n')
      : `No verbatim transcript lines were extracted. Video Title: "${params.title}" by "${params.channel}". Total duration: ${safeDuration}s.`;

  const categoryDirective =
    params.category === 'All Viral Moments'
      ? 'Find the strongest moments across Funny Moments, Adventure Moments, Emotional Moments, Action Moments, and Motivational Moments.'
      : `Focus specifically on finding "${params.category}" moments.`;

  const response = await generateWithFallback(
    ai,
    {
      contents: `You are an expert short-form viral video editor for YouTube Shorts, Instagram Reels, and TikTok.

Video Metadata:
- Title: ${params.title}
- Creator: ${params.channel}
- Total Video Duration: ${safeDuration.toFixed(1)} seconds
- Target Clip Duration: ~${clampedTarget} seconds (each clip must be within 0 and ${safeDuration.toFixed(1)} seconds)
- Category Preference: ${categoryDirective}

Transcript / Content:
${transcriptText}

Identify 4 distinct high-retention clip moments from this video.
For each clip:
1. Choose accurate startTime and endTime (close to ${clampedTarget}s duration, never exceeding ${safeDuration.toFixed(1)}s).
2. Write a punchy hook title (4-8 words) matching the video's vibe & language.
3. Classify into one of: "Funny Moments", "Adventure Moments", "Emotional Moments", "Action Moments", "Motivational Moments".
4. Explain briefly in hookReason why this moment hooks viewers in the first 3 seconds.
5. Also generate word-by-word lyrical subtitle lines ("lyrics") covering the spoken speech inside that clip's [startTime, endTime] window in the detected language (${params.detectedLanguage || 'Hindi / Hinglish / English / Punjabi'}). Only produce subtitles that match the transcript if transcript is provided; if no transcript is available, produce concise speaker narration cues matching the clip topic and timestamps.`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING },
            clips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  category: { type: Type.STRING },
                  startTime: { type: Type.NUMBER },
                  endTime: { type: Type.NUMBER },
                  hookReason: { type: Type.STRING },
                  lyrics: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                      },
                      required: ['text', 'start', 'end'],
                    },
                  },
                },
                required: ['title', 'category', 'startTime', 'endTime', 'hookReason'],
              },
            },
          },
          required: ['detectedLanguage', 'clips'],
        },
      },
    },
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite'
  );

  const parsed = JSON.parse(response.text ?? '{}') as {
    detectedLanguage?: string;
    clips?: Array<{
      title: string;
      category: string;
      startTime: number;
      endTime: number;
      hookReason: string;
      lyrics?: TranscriptSegment[];
    }>;
  };

  const detectedLanguage = parsed.detectedLanguage?.trim() || params.detectedLanguage || 'English';

  const moments: ClipMoment[] = (parsed.clips ?? []).slice(0, 5).map((clip, idx) => {
    let start = Math.max(0, Math.min(safeDuration - 5, Number(clip.startTime ?? 0)));
    let end = Math.max(start + 5, Math.min(safeDuration, Number(clip.endTime ?? start + clampedTarget)));
    if (end - start < 5) {
      start = Math.max(0, end - clampedTarget);
    }
    start = Number(start.toFixed(1));
    end = Number(end.toFixed(1));

    let words = buildWordTokensFromSegments(params.transcriptSegments, start, end);
    if (words.length === 0 && Array.isArray(clip.lyrics) && clip.lyrics.length > 0) {
      const normalizedLyrics = clip.lyrics.map((l) => ({
        text: String(l.text ?? '').trim(),
        start: Math.max(start, Number(l.start ?? start)),
        end: Math.min(end, Number(l.end ?? start + 2)),
      }));
      words = buildWordTokensFromSegments(normalizedLyrics, start, end);
    }

    return {
      id: `clip-${idx + 1}-${Date.now().toString(36)}`,
      title: clip.title?.trim() || `Highlight Clip ${idx + 1}`,
      category: normalizeCategory(clip.category ?? '', params.category),
      startTime: start,
      endTime: end,
      duration: Number((end - start).toFixed(1)),
      hookReason: clip.hookReason?.trim() || 'High-energy opening hook with strong pacing.',
      detectedLanguage,
      words,
      cropPan: 0,
    };
  });

  return {
    detectedLanguage,
    moments,
  };
}
