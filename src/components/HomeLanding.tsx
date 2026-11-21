import React, { useRef, useState } from 'react';
import { ArrowRight, Film, Link2, Loader2, Scissors, Sparkles, Upload } from 'lucide-react';
import type { MomentCategory } from '../types/clip.ts';

interface HomeLandingProps {
  isLoading: boolean;
  loadingStep: string;
  error: string | null;
  onAnalyzeUrl: (url: string, category: MomentCategory, targetDuration: number) => void;
  onUploadFile: (file: File, category: MomentCategory, targetDuration: number) => void;
}

const CATEGORIES: MomentCategory[] = [
  'All Viral Moments',
  'Funny Moments',
  'Adventure Moments',
  'Emotional Moments',
  'Action Moments',
  'Motivational Moments',
];

const PRESET_DURATIONS = [15, 30, 45, 60, 90];

export const HomeLanding: React.FC<HomeLandingProps> = ({
  isLoading,
  loadingStep,
  error,
  onAnalyzeUrl,
  onUploadFile,
}) => {
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<MomentCategory>('All Viral Moments');
  const [selectedDuration, setSelectedDuration] = useState<number>(30);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customSeconds, setCustomSeconds] = useState('40');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const effectiveDuration = isCustomDuration
    ? Math.max(5, Math.min(180, parseInt(customSeconds, 10) || 30))
    : selectedDuration;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isLoading) return;
    onAnalyzeUrl(url.trim(), category, effectiveDuration);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && !isLoading) {
      onUploadFile(file, category, effectiveDuration);
    }
    e.target.value = '';
  };

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
      {/* Hero & Main YouTube Link Box */}
      <section id="clip-input" className="mx-auto max-w-4xl text-center">
        <p className="text-xs font-medium tracking-wide text-amber-400">
          YouTube to 9:16 Vertical Shorts · 1080p MP4 Export
        </p>

        <h1
          className="mt-4 font-display font-bold tracking-tight text-white"
          style={{
            fontSize: 'clamp(2.25rem, 4.4vw, 3.75rem)',
            lineHeight: 1.08,
            textWrap: 'balance',
          }}
        >
          Turn long videos into viral 9:16 clips with lyrical subtitles.
        </h1>

        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400">
          Paste any YouTube link or upload a video. AI finds the sharpest Funny, Adventure,
          Emotional, Action, or Motivational moments, crops to 1080×1920, syncs word-by-word
          Hinglish, Hindi, English, or Punjabi subtitles, and exports crisp MP4.
        </p>

        {/* Primary Capture Card */}
        <form
          onSubmit={handleSubmit}
          className="mt-9 rounded-2xl border border-[#242836] bg-[#12141B] p-4 text-left sm:p-6"
        >
          <label
            htmlFor="youtube-url-input"
            className="block text-xs font-semibold tracking-wide text-zinc-300"
          >
            Paste YouTube Link
          </label>

          <div className="mt-2.5 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
              <input
                id="youtube-url-input"
                type="text"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... or youtu.be/..."
                disabled={isLoading}
                required
                className="h-13 w-full rounded-xl border border-[#2A2F40] bg-[#0A0B0F] pl-12 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="inline-flex h-13 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 text-sm font-semibold text-zinc-950 hover:bg-amber-400 transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing
                </>
              ) : (
                <>
                  Analyze Video
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>

          {/* Moment Category Selector */}
          <div className="mt-6">
            <span className="block text-xs font-medium text-zinc-400">
              Moment Category
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => {
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    disabled={isLoading}
                    onClick={() => setCategory(cat)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-[#252938] bg-[#171A24] text-zinc-300 hover:border-zinc-600 hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Clip Duration Selector + Upload Trigger */}
          <div className="mt-5 flex flex-col gap-4 border-t border-[#1F2330] pt-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="block text-xs font-medium text-zinc-400">
                Clip Duration
              </span>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {PRESET_DURATIONS.map((sec) => {
                  const active = !isCustomDuration && selectedDuration === sec;
                  return (
                    <button
                      key={sec}
                      type="button"
                      disabled={isLoading}
                      onClick={() => {
                        setIsCustomDuration(false);
                        setSelectedDuration(sec);
                      }}
                      className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-[#252938] bg-[#171A24] text-zinc-300 hover:border-zinc-600 hover:text-white'
                      }`}
                    >
                      {sec}s
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => setIsCustomDuration(true)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isCustomDuration
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-[#252938] bg-[#171A24] text-zinc-300 hover:border-zinc-600 hover:text-white'
                  }`}
                >
                  Custom
                </button>
                {isCustomDuration && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={customSeconds}
                      onChange={(e) => setCustomSeconds(e.target.value)}
                      aria-label="Custom clip duration in seconds"
                      className="w-20 rounded-lg border border-amber-500/60 bg-[#0A0B0F] px-2.5 py-1.5 font-mono text-xs text-white tabular-nums focus:outline-none"
                    />
                    <span className="text-xs text-zinc-400">sec</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={isLoading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-[#2A2F40] bg-[#181B25] px-4 py-2 text-xs font-medium text-zinc-200 hover:border-zinc-500 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5 text-amber-400" />
                Upload MP4 / MOV Instead
              </button>
            </div>
          </div>

          {isLoading && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" />
              <span>{loadingStep}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs leading-relaxed text-red-200"
            >
              {error}
            </div>
          )}
        </form>
      </section>

      {/* Asymmetric Feature Showcase */}
      <section id="features" className="mt-20 space-y-6">
        <div className="flex flex-col justify-between gap-3 border-b border-[#1E222E] pb-5 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Built for Shorts, Reels, and TikTok creators
            </h2>
            <p className="mt-1.5 text-sm text-zinc-400">
              Every step runs cleanly from URL analysis to 1080×1920 MP4 export.
            </p>
          </div>
          <p className="font-mono text-xs text-zinc-400 tabular-nums">
            1080×1920 · H.264 MP4 · Hindi / Hinglish / English / Punjabi
          </p>
        </div>

        {/* Bento Row 1: Vertical Preview Showcase + Moment Detection */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 3-Frame 9:16 Vertical Preview Showcase */}
          <div
            id="vertical-format"
            className="lg:col-span-7 rounded-2xl border border-[#222633] bg-[#12141B] p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-white">
                  01. Auto 9:16 Subject Crop & Category Moments
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Landscape footage is centered onto the main speaker or action at full 1080×1920
                  portrait resolution.
                </p>
              </div>
              <Scissors className="h-5 w-5 shrink-0 text-amber-400" />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
              <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-[#262A38] bg-black">
                <img
                  src="/src/assets/images/clip_podcast_studio_1795250927621.jpg"
                  alt="Podcast funny moment cropped to 9:16 vertical"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                <div className="absolute inset-x-2.5 bottom-3 text-center">
                  <p className="font-display text-xs font-extrabold text-white sm:text-sm">
                    BHAI <span className="text-amber-400">YE KYA</span> BOL DIYA
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-300">Funny Moments · 30s</p>
                </div>
              </div>

              <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-[#262A38] bg-black">
                <img
                  src="/src/assets/images/clip_adventure_mountain_1795250927302.jpg"
                  alt="Himalayan adventure vlog cropped to 9:16 vertical"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                <div className="absolute inset-x-2.5 bottom-3 text-center">
                  <p className="font-display text-xs font-extrabold text-white sm:text-sm">
                    SUMMIT <span className="text-cyan-400">AT</span> SUNRISE
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-300">Adventure · 45s</p>
                </div>
              </div>

              <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-[#262A38] bg-black">
                <img
                  src="/src/assets/images/clip_motivational_stage_1795250927584.jpg"
                  alt="Stage keynote motivational moment cropped to 9:16 vertical"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                <div className="absolute inset-x-2.5 bottom-3 text-center">
                  <p className="font-display text-xs font-extrabold text-white sm:text-sm">
                    NEVER <span className="text-emerald-400">STOP</span> BUILDING
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-300">Motivational · 60s</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Lyrical Subtitles & 1080p Export Details */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <div
              id="lyrical-subtitles"
              className="flex-1 rounded-2xl border border-[#222633] bg-[#12141B] p-6"
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-lg font-semibold text-white">
                  02. Lyrical Word-by-Word Subtitles
                </h3>
                <Sparkles className="h-5 w-5 shrink-0 text-amber-400" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Auto-detects Hindi, Hinglish, English, and Punjabi speech. Highlights every word
                in sync with the speaker voice, with custom fonts, sizes, presets, and colors.
              </p>

              <div className="mt-5 rounded-xl border border-[#252938] bg-[#0A0B0F] p-4 text-center">
                <p className="font-display text-xl font-extrabold tracking-tight text-white">
                  Aaj hum <span className="text-amber-400">seekhenge</span> viral{' '}
                  <span className="text-zinc-400">reels banana</span>
                </p>
                <p className="mt-2 font-mono text-[11px] text-zinc-400 tabular-nums">
                  Hinglish Detected · Synced Word Tokens · Live Editable
                </p>
              </div>
            </div>

            <div
              id="export-workflow"
              className="flex-1 rounded-2xl border border-[#222633] bg-[#12141B] p-6"
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-lg font-semibold text-white">
                  03. Trim, Edit & Export 1080p MP4
                </h3>
                <Film className="h-5 w-5 shrink-0 text-amber-400" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Fine-tune start and end timestamps, edit any misheard subtitle word, pan the 9:16
                subject frame left or right, and burn subtitles directly into high-bitrate H.264
                MP4 via FFmpeg.
              </p>

              <div className="mt-5 flex items-center justify-between border-t border-[#1F2330] pt-4 text-xs text-zinc-400">
                <span>Output Format</span>
                <span className="font-mono text-zinc-200 tabular-nums">
                  1080×1920 · 192kbps AAC · MP4
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="mt-20 flex flex-col items-center justify-between gap-4 border-t border-[#1E222E] pt-8 text-xs text-zinc-500 sm:flex-row">
        <span className="font-display font-semibold text-zinc-300">ClipKaro AI</span>
        <p>AI Video Clipping & Lyrical Subtitle Studio</p>
      </footer>
    </main>
  );
};
