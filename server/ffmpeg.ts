import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import type { SubtitleStyle, WordToken } from '../src/types/clip.ts';

const execFileAsync = promisify(execFile);

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
}

export async function probeVideo(videoPath: string): Promise<VideoProbe> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    videoPath,
  ]);

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };

  const width = parsed.streams?.[0]?.width ?? 1920;
  const height = parsed.streams?.[0]?.height ?? 1080;
  const duration = Math.max(1, Number(parsed.format?.duration ?? 30));
  return { duration, width, height };
}

export async function extractAudioForAI(
  videoPath: string,
  outputMp3Path: string
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '32k',
    outputMp3Path,
  ]);
}

/** Convert #RRGGBB hex to ASS &H00BBGGRR& color string */
function hexToAssColor(hex: string, alphaHex = '00'): string {
  const cleaned = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `&H${alphaHex}FFFFFF`;
  }
  const r = cleaned.slice(0, 2).toUpperCase();
  const g = cleaned.slice(2, 4).toUpperCase();
  const b = cleaned.slice(4, 6).toUpperCase();
  return `&H${alphaHex}${b}${g}${r}`;
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.floor((clamped % 1) * 100);
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function mapAssFont(font: SubtitleStyle['font']): string {
  switch (font) {
    case 'JetBrains Mono':
      return 'JetBrains Mono';
    case 'Oswald':
      return 'Liberation Sans Narrow';
    case 'Plus Jakarta Sans':
      return 'Noto Sans';
    case 'Bricolage Grotesque':
    default:
      return 'Noto Sans';
  }
}

export function generateAssSubtitleFile(params: {
  words: WordToken[];
  style: SubtitleStyle;
  clipStartTime: number;
  clipDuration: number;
  outAssPath: string;
}): void {
  const { words, style, clipStartTime, clipDuration, outAssPath } = params;

  const fontSizeMap: Record<SubtitleStyle['size'], number> = {
    sm: 58,
    md: 72,
    lg: 88,
    xl: 104,
  };

  const marginVMap: Record<SubtitleStyle['position'], number> = {
    bottom: 260,
    center: 880,
    upper: 1320,
  };

  const fontName = mapAssFont(style.font);
  const fontSize = fontSizeMap[style.size] ?? 84;
  const marginV = marginVMap[style.position] ?? 260;

  const primaryAss = hexToAssColor(style.textColor);
  const highlightAss = hexToAssColor(style.highlightColor);
  const outlineAss = hexToAssColor(style.outlineColor);
  const backAss =
    style.preset === 'classic-reel' ? hexToAssColor('#000000', '44') : '&H88000000';

  const borderStyle = style.preset === 'classic-reel' ? 3 : 1;
  const outlineWidth = style.preset === 'classic-reel' ? 14 : 6;
  const shadowDepth = style.preset === 'neon-karaoke' ? 4 : 3;

  const header = `[Script Info]
Title: ClipKaro AI Lyrical Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyrical,${fontName},${fontSize},${primaryAss},${highlightAss},${outlineAss},${backAss},-1,0,0,0,100,100,1,0,${borderStyle},${outlineWidth},${shadowDepth},2,64,64,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Filter and shift word timings relative to clipStartTime
  const relativeWords = words
    .map((w) => ({
      word: style.uppercase ? w.word.toUpperCase() : w.word,
      start: Math.max(0, w.start - clipStartTime),
      end: Math.min(clipDuration, w.end - clipStartTime),
    }))
    .filter((w) => w.end > 0 && w.start < clipDuration && w.word.trim().length > 0);

  const wordsPerLine = Math.max(2, Math.min(6, style.wordsPerLine || 3));
  const lines: string[] = [];

  for (let i = 0; i < relativeWords.length; i += wordsPerLine) {
    const chunk = relativeWords.slice(i, i + wordsPerLine);
    const chunkStart = chunk[0].start;
    const chunkEnd = chunk[chunk.length - 1].end;

    // Emit one timed event per active word in this phrase for crisp word-by-word highlight + pop
    for (let wIdx = 0; wIdx < chunk.length; wIdx++) {
      const activeWord = chunk[wIdx];
      const eventStart = wIdx === 0 ? chunkStart : activeWord.start;
      const nextWord = chunk[wIdx + 1];
      const eventEnd = nextWord ? Math.max(activeWord.end, nextWord.start) : chunkEnd;

      if (eventEnd <= eventStart) continue;

      const formattedLine = chunk
        .map((token, tIdx) => {
          const safeWord = escapeAssText(token.word);
          if (tIdx === wIdx) {
            const popScale = style.preset === 'lyrical-pop' || style.preset === 'desi-bold' ? '\\fscx112\\fscy112' : '';
            return `{\\c${highlightAss}${popScale}}${safeWord}{\\c${primaryAss}\\fscx100\\fscy100}`;
          }
          return safeWord;
        })
        .join(' ');

      lines.push(
        `Dialogue: 0,${formatAssTime(eventStart)},${formatAssTime(eventEnd)},Lyrical,,0,0,0,,${formattedLine}`
      );
    }
  }

  fs.writeFileSync(outAssPath, header + lines.join('\n') + '\n', 'utf8');
}

export async function renderVerticalClipMp4(params: {
  sourcePath: string;
  outPath: string;
  assPath: string;
  startTime: number;
  duration: number;
  cropPan: number; // -1 to 1
}): Promise<void> {
  const { sourcePath, outPath, assPath, startTime, duration, cropPan } = params;

  const safeStart = Math.max(0, Number(startTime) || 0);
  const safeDuration = Math.max(2, Math.min(300, Number(duration) || 30));
  const clampedPan = Math.max(-1, Math.min(1, Number(cropPan) || 0));

  // Escape ASS path safely for FFmpeg filtergraph
  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

  // Scale source to cover 1080x1920 preserving aspect ratio, then crop 1080x1920 centered around pan
  const panExpr = `(iw-1080)/2 + (iw-1080)/2*${clampedPan.toFixed(3)}`;
  const vf = [
    'scale=1080:1920:force_original_aspect_ratio=increase',
    `crop=1080:1920:x='max(0,min(iw-1080,${panExpr}))':y='max(0,(ih-1920)/2)'`,
    'setsar=1',
    `ass='${escapedAss}'`,
  ].join(',');

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      safeStart.toFixed(2),
      '-i',
      sourcePath,
      '-t',
      safeDuration.toFixed(2),
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outPath,
    ],
    { maxBuffer: 1024 * 1024 * 10 }
  );
}
