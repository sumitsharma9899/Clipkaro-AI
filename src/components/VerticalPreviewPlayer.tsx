import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Upload, Volume2, VolumeX } from 'lucide-react';
import type { ClipMoment, SubtitleStyle, WordToken } from '../types/clip.ts';

interface VerticalPreviewPlayerProps {
  jobId: string;
  videoReady: boolean;
  youtubeVideoId?: string;
  thumbnailUrl?: string;
  clip: ClipMoment;
  style: SubtitleStyle;
  seekTrigger?: { time: number; seq: number } | null;
  onAttachVideoClick?: () => void;
}

function formatClock(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const tenth = Math.floor((safe % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenth}`;
}

export const VerticalPreviewPlayer: React.FC<VerticalPreviewPlayerProps> = ({
  jobId,
  videoReady,
  youtubeVideoId,
  thumbnailUrl,
  clip,
  style,
  seekTrigger,
  onAttachVideoClick,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip.startTime);

  const clipDuration = Math.max(2, clip.endTime - clip.startTime);
  const useYouTubeEmbed = !videoReady && Boolean(youtubeVideoId);

  const sendYtCommand = (func: string, args: unknown[] = []) => {
    const win = ytIframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args,
      }),
      'https://www.youtube.com'
    );
  };

  // Sync when switching clip or trimming start/end
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(clip.startTime);
    if (videoReady && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = clip.startTime;
    } else if (useYouTubeEmbed) {
      sendYtCommand('pauseVideo');
      sendYtCommand('seekTo', [clip.startTime, true]);
    }
  }, [clip.id, clip.startTime, clip.endTime, videoReady, useYouTubeEmbed]);

  // Listen to YouTube IFrame API time updates when using YouTube embed
  useEffect(() => {
    if (!useYouTubeEmbed) return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.includes('youtube.com')) return;
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data) as {
          event?: string;
          info?: { currentTime?: number; playerState?: number };
        };
        if (msg.event === 'infoDelivery' && typeof msg.info?.currentTime === 'number') {
          const t = msg.info.currentTime;
          if (t >= clip.endTime) {
            sendYtCommand('seekTo', [clip.startTime, true]);
            setCurrentTime(clip.startTime);
          } else {
            setCurrentTime(t);
          }
        }
      } catch {
        // ignore non-JSON postMessages
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [useYouTubeEmbed, clip.startTime, clip.endTime]);

  // Handle explicit word-click seek from the subtitle editor
  useEffect(() => {
    if (!seekTrigger) return;
    const target = Math.max(clip.startTime, Math.min(clip.endTime - 0.1, seekTrigger.time));
    setCurrentTime(target);
    if (videoReady && videoRef.current) {
      videoRef.current.currentTime = target;
    } else if (useYouTubeEmbed) {
      sendYtCommand('seekTo', [target, true]);
    }
  }, [seekTrigger, clip.startTime, clip.endTime, videoReady, useYouTubeEmbed]);

  // 60fps time tracking for crisp word-by-word lyrical sync
  useEffect(() => {
    if (!isPlaying) return;

    let rafId = 0;
    let lastStamp = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastStamp) / 1000;
      lastStamp = now;

      if (videoReady && videoRef.current) {
        const vt = videoRef.current.currentTime;
        if (vt >= clip.endTime) {
          videoRef.current.currentTime = clip.startTime;
          setCurrentTime(clip.startTime);
        } else {
          setCurrentTime(vt);
        }
      } else {
        setCurrentTime((prev) => {
          const next = prev + dt;
          if (next >= clip.endTime) {
            if (useYouTubeEmbed) sendYtCommand('seekTo', [clip.startTime, true]);
            return clip.startTime;
          }
          return next;
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, videoReady, useYouTubeEmbed, clip.startTime, clip.endTime]);

  const togglePlay = () => {
    if (videoReady && videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        if (
          videoRef.current.currentTime < clip.startTime ||
          videoRef.current.currentTime >= clip.endTime
        ) {
          videoRef.current.currentTime = clip.startTime;
        }
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    } else if (useYouTubeEmbed) {
      if (isPlaying) {
        sendYtCommand('pauseVideo');
        setIsPlaying(false);
      } else {
        if (currentTime < clip.startTime || currentTime >= clip.endTime) {
          sendYtCommand('seekTo', [clip.startTime, true]);
          setCurrentTime(clip.startTime);
        }
        sendYtCommand('playVideo');
        setIsPlaying(true);
      }
    } else {
      setIsPlaying((prev) => !prev);
    }
  };

  const restartClip = () => {
    setCurrentTime(clip.startTime);
    if (videoReady && videoRef.current) {
      videoRef.current.currentTime = clip.startTime;
    } else if (useYouTubeEmbed) {
      sendYtCommand('seekTo', [clip.startTime, true]);
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rel = Number(e.target.value);
    const abs = clip.startTime + rel;
    setCurrentTime(abs);
    if (videoReady && videoRef.current) {
      videoRef.current.currentTime = abs;
    } else if (useYouTubeEmbed) {
      sendYtCommand('seekTo', [abs, true]);
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = next;
    } else if (useYouTubeEmbed) {
      sendYtCommand(next ? 'mute' : 'unMute');
    }
  };

  // Group words into lyrical lines
  const phraseChunks = useMemo(() => {
    const words = clip.words.filter(
      (w) => w.end >= clip.startTime && w.start <= clip.endTime && w.word.trim().length > 0
    );
    const perLine = Math.max(2, Math.min(6, style.wordsPerLine));
    const chunks: WordToken[][] = [];
    for (let i = 0; i < words.length; i += perLine) {
      chunks.push(words.slice(i, i + perLine));
    }
    return chunks;
  }, [clip.words, clip.startTime, clip.endTime, style.wordsPerLine]);

  const activeChunk = useMemo(() => {
    return (
      phraseChunks.find((chunk) => {
        const cStart = chunk[0].start;
        const cEnd = chunk[chunk.length - 1].end;
        return currentTime >= cStart - 0.12 && currentTime <= cEnd + 0.18;
      }) ?? null
    );
  }, [phraseChunks, currentTime]);

  const fontSizeClass = {
    sm: 'text-base sm:text-lg',
    md: 'text-xl sm:text-2xl',
    lg: 'text-2xl sm:text-[28px]',
    xl: 'text-3xl sm:text-[34px]',
  }[style.size];

  const fontFamilyStyle = {
    'Bricolage Grotesque': '"Bricolage Grotesque", sans-serif',
    'Plus Jakarta Sans': '"Plus Jakarta Sans", sans-serif',
    Oswald: '"Oswald", sans-serif',
    'JetBrains Mono': '"JetBrains Mono", monospace',
  }[style.font];

  const positionClass = {
    bottom: 'bottom-14',
    center: 'top-1/2 -translate-y-1/2',
    upper: 'top-20',
  }[style.position];

  const cropXPercent = Math.round(((clip.cropPan + 1) / 2) * 100);
  const relElapsed = Math.max(0, Math.min(clipDuration, currentTime - clip.startTime));

  // For 16:9 YouTube iframe inside a 9:16 portrait container, scale width to 316% and pan horizontally
  const iframeTranslatePercent = -50 - clip.cropPan * 32;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* 9:16 Vertical Phone Stage */}
      <div className="relative w-full max-w-[340px] aspect-[9/16] overflow-hidden rounded-2xl border border-[#2A2F40] bg-black shadow-2xl">
        {videoReady ? (
          <video
            ref={videoRef}
            src={`/api/video/stream/${jobId}`}
            playsInline
            muted={isMuted}
            onClick={togglePlay}
            className="h-full w-full object-cover cursor-pointer"
            style={{ objectPosition: `${cropXPercent}% 50%` }}
          />
        ) : useYouTubeEmbed ? (
          <div className="relative h-full w-full overflow-hidden bg-black">
            <iframe
              ref={ytIframeRef}
              title={clip.title}
              src={`https://www.youtube.com/embed/${youtubeVideoId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&controls=0&start=${Math.floor(clip.startTime)}`}
              allow="autoplay; encrypted-media; picture-in-picture"
              onLoad={() => {
                // Subscribe to YouTube iframe infoDelivery events
                ytIframeRef.current?.contentWindow?.postMessage(
                  JSON.stringify({ event: 'listening', id: 1 }),
                  'https://www.youtube.com'
                );
              }}
              className="pointer-events-none absolute top-0 h-full border-0"
              style={{
                width: '316%',
                left: '50%',
                transform: `translateX(${iframeTranslatePercent}%)`,
              }}
            />
            {/* Click-to-play scrim over iframe */}
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause YouTube clip' : 'Play YouTube clip'}
              className="absolute inset-0 z-10 cursor-pointer bg-transparent focus:outline-none"
            />
          </div>
        ) : (
          <div className="relative h-full w-full bg-[#101218]">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={clip.title}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover opacity-55"
                style={{ objectPosition: `${cropXPercent}% 50%` }}
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-b from-[#171B26] to-[#0A0B0F]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/50" />
            {onAttachVideoClick && (
              <div className="absolute inset-x-4 top-6 flex flex-col items-center text-center gap-2 rounded-xl border border-white/15 bg-black/65 p-3.5 backdrop-blur-sm">
                <p className="text-xs font-medium text-zinc-200 leading-relaxed">
                  Attach source MP4/MOV to unlock 1080p FFmpeg export
                </p>
                <button
                  type="button"
                  onClick={onAttachVideoClick}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Attach Video File
                </button>
              </div>
            )}
          </div>
        )}

        {/* Subtle legibility gradient behind bottom subtitles */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-44 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* Live Lyrical Word-by-Word Subtitles Overlay */}
        {activeChunk && (
          <div
            className={`pointer-events-none absolute inset-x-4 z-30 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center leading-tight ${positionClass}`}
            style={{ fontFamily: fontFamilyStyle }}
          >
            {activeChunk.map((tok) => {
              const isSpoken = currentTime >= tok.start && currentTime <= tok.end + 0.06;
              const displayWord = style.uppercase ? tok.word.toUpperCase() : tok.word;

              const textShadow =
                style.preset === 'neon-karaoke' && isSpoken
                  ? `0 0 18px ${style.highlightColor}, 0 2px 6px ${style.outlineColor}`
                  : `0 3px 10px ${style.outlineColor}, -1.5px -1.5px 0 ${style.outlineColor}, 1.5px -1.5px 0 ${style.outlineColor}, -1.5px 1.5px 0 ${style.outlineColor}, 1.5px 1.5px 0 ${style.outlineColor}`;

              const bgStyle =
                style.preset === 'classic-reel'
                  ? {
                      backgroundColor: 'rgba(10, 11, 15, 0.82)',
                      padding: '2px 8px',
                      borderRadius: '6px',
                    }
                  : {};

              return (
                <span
                  key={tok.id}
                  className={`inline-block font-extrabold tracking-tight transition-transform duration-100 ${fontSizeClass}`}
                  style={{
                    color: isSpoken ? style.highlightColor : style.textColor,
                    transform:
                      isSpoken && (style.preset === 'lyrical-pop' || style.preset === 'desi-bold')
                        ? 'scale(1.12)'
                        : 'scale(1)',
                    textShadow,
                    ...bgStyle,
                  }}
                >
                  {displayWord}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Compact Transport Controls */}
      <div className="w-full max-w-[340px] rounded-xl border border-[#222633] bg-[#12141B] p-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause clip preview' : 'Play clip preview'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors cursor-pointer"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={restartClip}
            aria-label="Restart clip"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#262A38] bg-[#181B24] text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <div className="flex-1 min-w-0">
            <input
              type="range"
              min={0}
              max={clipDuration}
              step={0.05}
              value={relElapsed}
              onChange={handleScrub}
              aria-label="Seek within clip"
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-zinc-400 tabular-nums">
              <span>{formatClock(relElapsed)}</span>
              <span>{formatClock(clipDuration)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#262A38] bg-[#181B24] text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};
