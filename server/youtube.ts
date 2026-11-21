import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { Innertube, UniversalCache } from 'youtubei.js';
import { Ytdl, chooseFormat } from '@distube/ytdl-core';
import type { TranscriptSegment } from '../src/types/clip.ts';

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
]);

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeId(rawInput: string): string | null {
  try {
    const trimmed = rawInput.trim();
    // Allow pasting share text containing a YouTube URL or a bare 11-char ID
    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
    const candidateStr = urlMatch ? urlMatch[0] : trimmed;

    if (VIDEO_ID_REGEX.test(candidateStr)) {
      return candidateStr;
    }

    const withProtocol = /^https?:\/\//i.test(candidateStr)
      ? candidateStr
      : `https://${candidateStr}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_YOUTUBE_HOSTS.has(hostname)) {
      return null;
    }

    let candidate: string | null = null;
    if (hostname === 'youtu.be') {
      candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (parsed.pathname.startsWith('/shorts/')) {
      candidate = parsed.pathname.split('/')[2] ?? null;
    } else if (parsed.pathname.startsWith('/embed/')) {
      candidate = parsed.pathname.split('/')[2] ?? null;
    } else if (parsed.pathname.startsWith('/live/')) {
      candidate = parsed.pathname.split('/')[2] ?? null;
    } else {
      candidate = parsed.searchParams.get('v');
    }

    if (candidate && VIDEO_ID_REGEX.test(candidate)) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export interface YouTubeFetchResult {
  videoId: string;
  canonicalUrl: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  duration: number;
  transcriptSegments: TranscriptSegment[];
  videoReady: boolean;
  streamBlockedReason?: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchOEmbedMetadata(canonicalUrl: string): Promise<{
  title?: string;
  channel?: string;
  thumbnailUrl?: string;
}> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title,
      channel: data.author_name,
      thumbnailUrl: data.thumbnail_url,
    };
  } catch {
    return {};
  }
}

export async function fetchAndDownloadYouTube(
  videoId: string,
  destVideoPath: string
): Promise<YouTubeFetchResult> {
  if (!VIDEO_ID_REGEX.test(videoId)) {
    throw new Error('Invalid YouTube video ID.');
  }

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let title = `YouTube Video (${videoId})`;
  let channel = 'YouTube Creator';
  let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let duration = 0;
  const transcriptSegments: TranscriptSegment[] = [];
  let videoReady = false;
  let streamBlockedReason: string | undefined;

  const [oembed, ytClient] = await Promise.all([
    fetchOEmbedMetadata(canonicalUrl),
    withTimeout(
      Innertube.create({
        cache: new UniversalCache(false),
        generate_session_locally: true,
      }),
      3500,
      'Innertube init'
    ).catch(() => null),
  ]);

  if (oembed.title) title = oembed.title;
  if (oembed.channel) channel = oembed.channel;
  if (oembed.thumbnailUrl) thumbnailUrl = oembed.thumbnailUrl;

  // 1. Try Innertube (youtubei.js) with fast 3.5s timeout
  if (ytClient) {
    try {
      const info = await withTimeout(ytClient.getInfo(videoId), 3500, 'Innertube getInfo');
      const basic = info.basic_info;
      if (basic.title) title = basic.title;
      if (basic.author) channel = basic.author;
      if (basic.duration && basic.duration > 0) duration = basic.duration;
      if (basic.thumbnail?.[0]?.url) thumbnailUrl = basic.thumbnail[0].url;

    // Only attempt transcript & download if player returned valid video metadata
    if (basic.title) {
      try {
        const transcriptData = await withTimeout(info.getTranscript(), 4000, 'Transcript fetch');
        const initialSegments =
          transcriptData?.transcript?.content?.body?.initial_segments ?? [];
        for (const seg of initialSegments) {
          if (seg && 'snippet' in seg && seg.snippet?.text) {
            const startSec = Number(seg.start_ms ?? 0) / 1000;
            const endSec = Number(seg.end_ms ?? Number(seg.start_ms ?? 0) + 3000) / 1000;
            const cleaned = seg.snippet.text.replace(/\s+/g, ' ').trim();
            if (cleaned) {
              transcriptSegments.push({
                text: cleaned,
                start: startSec,
                end: Math.max(endSec, startSec + 0.5),
              });
            }
          }
        }
      } catch {
        // Transcript unavailable
      }

      try {
        const stream = await withTimeout(
          info.download({
            type: 'video+audio',
            quality: 'best',
            format: 'mp4',
          }),
          15000,
          'Innertube download'
        );
        const nodeStream = Readable.fromWeb(
          stream as unknown as import('stream/web').ReadableStream
        );
        const writeStream = fs.createWriteStream(destVideoPath);
        await pipeline(nodeStream, writeStream);
        const stat = fs.statSync(destVideoPath);
        if (stat.size > 10_000) {
          videoReady = true;
        } else {
          fs.rmSync(destVideoPath, { force: true });
        }
      } catch (err) {
        streamBlockedReason =
          err instanceof Error ? err.message : 'Unable to download stream via Innertube';
        fs.rmSync(destVideoPath, { force: true });
      }
    }
  } catch (err) {
    streamBlockedReason =
      err instanceof Error ? err.message : 'YouTube metadata fetch interrupted';
  }
  }

  // 2. Secondary stream download fallback via @distube/ytdl-core (hard 4s lookup timeout)
  if (!videoReady) {
    try {
      const ytdl = new Ytdl({ timeoutMs: 3500 });
      const ytdlInfo = await withTimeout(
        ytdl.getInfo(canonicalUrl, {
          signal: AbortSignal.timeout(4000),
        }),
        4000,
        'ytdl getInfo'
      );
      if (ytdlInfo.videoDetails?.title) title = ytdlInfo.videoDetails.title;
      if (ytdlInfo.videoDetails?.author?.name) channel = ytdlInfo.videoDetails.author.name;
      if (ytdlInfo.videoDetails?.lengthSeconds) {
        duration = Number(ytdlInfo.videoDetails.lengthSeconds) || duration;
      }

      const format = chooseFormat(ytdlInfo.formats, {
        filter: (f) => Boolean(f.hasVideo && f.hasAudio),
      });

      if (format?.url) {
        const videoStream = ytdl.download(ytdlInfo, { format });
        const writeStream = fs.createWriteStream(destVideoPath);
        await withTimeout(pipeline(videoStream, writeStream), 20000, 'ytdl stream download');
        const stat = fs.statSync(destVideoPath);
        if (stat.size > 10_000) {
          videoReady = true;
          streamBlockedReason = undefined;
        } else {
          fs.rmSync(destVideoPath, { force: true });
        }
      }
    } catch (fallbackErr) {
      fs.rmSync(destVideoPath, { force: true });
      if (!streamBlockedReason) {
        streamBlockedReason =
          fallbackErr instanceof Error
            ? fallbackErr.message
            : 'YouTube restricted direct server download for this video';
      }
    }
  }

  if (duration === 0 && transcriptSegments.length > 0) {
    duration = Math.ceil(transcriptSegments[transcriptSegments.length - 1].end);
  }
  if (duration === 0) {
    duration = 120;
  }

  return {
    videoId,
    canonicalUrl,
    title,
    channel,
    thumbnailUrl,
    duration,
    transcriptSegments,
    videoReady,
    streamBlockedReason: videoReady
      ? undefined
      : 'YouTube blocked direct server media streaming for this video. Attach your MP4/MOV file in the studio to preview & render 1080p FFmpeg clips.',
  };
}
