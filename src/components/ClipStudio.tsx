import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Type as TypeIcon,
  Upload,
} from 'lucide-react';
import type {
  ClipMoment,
  MomentCategory,
  SubtitleFont,
  SubtitlePosition,
  SubtitlePreset,
  SubtitleSize,
  SubtitleStyle,
  VideoJobInfo,
} from '../types/clip.ts';
import { parseApiJson } from '../utils/api.ts';
import { VerticalPreviewPlayer } from './VerticalPreviewPlayer.tsx';

interface ClipStudioProps {
  job: VideoJobInfo;
  onBackHome: () => void;
  onJobUpdated: (updated: VideoJobInfo) => void;
  onAttachUpload: (file: File, existingJobId: string, category: MomentCategory, targetDuration: number) => Promise<void>;
}

const CATEGORIES: MomentCategory[] = [
  'All Viral Moments',
  'Funny Moments',
  'Adventure Moments',
  'Emotional Moments',
  'Action Moments',
  'Motivational Moments',
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

const HIGHLIGHT_COLORS = [
  { label: 'Amber', hex: '#F59E0B' },
  { label: 'Cyan', hex: '#22D3EE' },
  { label: 'Mint', hex: '#34D399' },
  { label: 'Coral', hex: '#FB7185' },
  { label: 'Lime', hex: '#A3E635' },
  { label: 'White', hex: '#FFFFFF' },
];

const TEXT_COLORS = [
  { label: 'White', hex: '#FFFFFF' },
  { label: 'Warm Cream', hex: '#FEF3C7' },
  { label: 'Soft Gray', hex: '#E4E4E7' },
];

const PRESETS: Array<{ id: SubtitlePreset; label: string }> = [
  { id: 'lyrical-pop', label: 'Lyrical Pop' },
  { id: 'neon-karaoke', label: 'Neon Karaoke' },
  { id: 'classic-reel', label: 'Classic Reel' },
  { id: 'desi-bold', label: 'Desi Bold' },
];

const FONTS: SubtitleFont[] = [
  'Bricolage Grotesque',
  'Plus Jakarta Sans',
  'Oswald',
  'JetBrains Mono',
];

function formatSeconds(sec: number): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const ClipStudio: React.FC<ClipStudioProps> = ({
  job,
  onBackHome,
  onJobUpdated,
  onAttachUpload,
}) => {
  const [moments, setMoments] = useState<ClipMoment[]>(job.moments);
  const [selectedId, setSelectedId] = useState<string>(job.moments[0]?.id ?? '');
  const [inspectorTab, setInspectorTab] = useState<'style' | 'subtitles' | 'trim'>('style');

  const [categoryFilter, setCategoryFilter] = useState<MomentCategory>('All Viral Moments');
  const [targetDuration, setTargetDuration] = useState<number>(30);
  const [isRedetecting, setIsRedetecting] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<{
    downloadUrl: string;
    filename: string;
    fileSize: number;
  } | null>(null);

  const [isAttachingFile, setIsAttachingFile] = useState(false);
  const [seekTrigger, setSeekTrigger] = useState<{ time: number; seq: number } | null>(null);
  const attachFileRef = useRef<HTMLInputElement | null>(null);

  const [style, setStyle] = useState<SubtitleStyle>({
    preset: 'lyrical-pop',
    font: 'Bricolage Grotesque',
    size: 'lg',
    position: 'bottom',
    textColor: '#FFFFFF',
    highlightColor: '#F59E0B',
    outlineColor: '#000000',
    uppercase: false,
    wordsPerLine: 3,
  });

  // Sync local moments if job updates externally (e.g. after attaching file)
  React.useEffect(() => {
    setMoments(job.moments);
    if (job.moments.length > 0 && !job.moments.some((m) => m.id === selectedId)) {
      setSelectedId(job.moments[0].id);
    }
  }, [job, selectedId]);

  const activeClip = moments.find((m) => m.id === selectedId) ?? moments[0];

  const updateActiveClip = (updater: (clip: ClipMoment) => ClipMoment) => {
    if (!activeClip) return;
    setMoments((prev) => prev.map((m) => (m.id === activeClip.id ? updater(m) : m)));
    setLastExport(null);
  };

  const handleRedetect = async () => {
    setIsRedetecting(true);
    setExportError(null);
    try {
      const res = await fetch('/api/clips/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.jobId,
          category: categoryFilter,
          targetDuration,
        }),
      });
      const data = await parseApiJson<VideoJobInfo & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Failed to detect moments.');
      onJobUpdated(data);
      setMoments(data.moments);
      if (data.moments[0]) setSelectedId(data.moments[0].id);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to detect moments.');
    } finally {
      setIsRedetecting(false);
    }
  };

  const handleAttachFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAttachingFile(true);
    setExportError(null);
    try {
      await onAttachUpload(file, job.jobId, categoryFilter, targetDuration);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to attach video file.');
    } finally {
      setIsAttachingFile(false);
      e.target.value = '';
    }
  };

  const handleExportMp4 = async () => {
    if (!activeClip) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await fetch('/api/clips/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.jobId,
          title: activeClip.title,
          startTime: activeClip.startTime,
          endTime: activeClip.endTime,
          cropPan: activeClip.cropPan,
          words: activeClip.words,
          style,
        }),
      });
      const data = await parseApiJson<{
        downloadUrl: string;
        filename: string;
        fileSize: number;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'FFmpeg render failed.');
      }

      setLastExport({
        downloadUrl: data.downloadUrl,
        filename: data.filename,
        fileSize: data.fileSize,
      });

      // Trigger immediate browser download
      const anchor = document.createElement('a');
      anchor.href = data.downloadUrl;
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  if (!activeClip) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-zinc-400">No clips detected for this video.</p>
        <button
          type="button"
          onClick={onBackHome}
          className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      {/* Studio Context Bar */}
      <div className="flex flex-col gap-4 border-b border-[#222633] pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Projects
          </button>
          <h1 className="mt-1.5 truncate font-display text-xl font-bold tracking-tight text-white">
            {job.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>{job.channel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{formatSeconds(job.duration)} total</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {job.width}×{job.height} → 1080×1920
            </span>
            <span aria-hidden="true">·</span>
            <span>Language: {job.detectedLanguage}</span>
          </div>
        </div>

        {/* Quick Re-Detect Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as MomentCategory)}
            aria-label="Filter moment category"
            className="h-9 rounded-lg border border-[#282C3C] bg-[#12141B] px-3 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={targetDuration}
            onChange={(e) => setTargetDuration(Number(e.target.value))}
            aria-label="Target clip duration"
            className="h-9 rounded-lg border border-[#282C3C] bg-[#12141B] px-3 font-mono text-xs text-zinc-200 tabular-nums focus:border-amber-500 focus:outline-none"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}s clips
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={isRedetecting}
            onClick={handleRedetect}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#2D3244] bg-[#171A24] px-3.5 text-xs font-medium text-white hover:border-amber-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRedetecting ? 'animate-spin' : ''}`} />
            Re-Analyze Moments
          </button>
        </div>
      </div>

      {/* Hidden File Input for Attaching Local MP4 */}
      <input
        ref={attachFileRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        onChange={handleAttachFileChange}
        className="hidden"
      />

      {!job.videoReady && (
        <div className="mt-5 flex flex-col justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <div className="text-xs leading-relaxed text-amber-100">
            <span className="font-semibold text-amber-300">Video file needed for FFmpeg export: </span>
            {job.streamBlockedReason ||
              'YouTube restricted direct server download for this video. Attach your MP4/MOV file to unlock live video scrubbing and 1080p MP4 export.'}
          </div>
          <button
            type="button"
            disabled={isAttachingFile}
            onClick={() => attachFileRef.current?.click()}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            {isAttachingFile ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Processing Video...
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Attach Video File
              </>
            )}
          </button>
        </div>
      )}

      {/* Main 3-Column Studio Workspace */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: AI Detected Clips */}
        <aside className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-white">
              Detected Moments ({moments.length})
            </h2>
          </div>

          <div className="space-y-2.5">
            {moments.map((m, idx) => {
              const isSelected = m.id === activeClip.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(m.id);
                    setLastExport(null);
                    setExportError(null);
                  }}
                  className={`w-full rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-amber-500 bg-[#181B25]'
                      : 'border-[#222633] bg-[#12141B] hover:border-[#343A4F]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                    <span className="font-medium text-amber-400">
                      0{idx + 1}. {m.category}
                    </span>
                    <span className="font-mono tabular-nums">
                      {Math.round(m.endTime - m.startTime)}s
                    </span>
                  </div>
                  <p className="mt-1.5 font-display text-sm font-semibold leading-snug text-white">
                    {m.title}
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                    {m.hookReason}
                  </p>
                  <div className="mt-2 font-mono text-[11px] text-zinc-500 tabular-nums">
                    {formatSeconds(m.startTime)} – {formatSeconds(m.endTime)}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center: 9:16 Vertical Preview & Download MP4 */}
        <section className="lg:col-span-4 flex flex-col items-center">
          <VerticalPreviewPlayer
            jobId={job.jobId}
            videoReady={job.videoReady}
            youtubeVideoId={job.videoId}
            thumbnailUrl={job.thumbnailUrl}
            clip={activeClip}
            style={style}
            seekTrigger={seekTrigger}
            onAttachVideoClick={() => attachFileRef.current?.click()}
          />

          <div className="mt-4 w-full max-w-[340px] space-y-2.5">
            <button
              type="button"
              disabled={isExporting || !job.videoReady}
              onClick={handleExportMp4}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 text-sm font-semibold text-zinc-950 hover:bg-amber-400 transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Rendering 1080p MP4 via FFmpeg...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download MP4 (1080p)
                </>
              )}
            </button>

            {lastExport && (
              <a
                href={lastExport.downloadUrl}
                download={lastExport.filename}
                className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200 hover:bg-emerald-500/15 transition-colors"
              >
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Ready: {lastExport.filename}
                </span>
                <span className="font-mono tabular-nums text-emerald-300">
                  {(lastExport.fileSize / (1024 * 1024)).toFixed(1)} MB
                </span>
              </a>
            )}

            {exportError && (
              <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                {exportError}
              </p>
            )}
          </div>
        </section>

        {/* Right: Style, Subtitle Editor & Trim/Crop Inspector */}
        <section className="lg:col-span-5 rounded-2xl border border-[#222633] bg-[#12141B] flex flex-col overflow-hidden">
          {/* Inspector Segmented Tabs */}
          <div className="grid grid-cols-3 border-b border-[#222633] bg-[#0F1117] p-1.5 gap-1.5">
            <button
              type="button"
              onClick={() => setInspectorTab('style')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors cursor-pointer ${
                inspectorTab === 'style'
                  ? 'bg-[#1D212F] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Subtitle Style
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('subtitles')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors cursor-pointer ${
                inspectorTab === 'subtitles'
                  ? 'bg-[#1D212F] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <TypeIcon className="h-3.5 w-3.5" />
              Edit Lyrics ({activeClip.words.length})
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('trim')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors cursor-pointer ${
                inspectorTab === 'trim'
                  ? 'bg-[#1D212F] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Trim & Crop
            </button>
          </div>

          <div className="flex-1 p-5 overflow-y-auto max-h-[640px]">
            {inspectorTab === 'style' && (
              <div className="space-y-5">
                {/* Style Presets */}
                <div>
                  <span className="block text-xs font-medium text-zinc-400">
                    Lyrical Style Preset
                  </span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setStyle((s) => ({ ...s, preset: p.id }))}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors cursor-pointer ${
                          style.preset === p.id
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-[#252938] bg-[#171A24] text-zinc-300 hover:border-zinc-600'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Selection */}
                <div>
                  <span className="block text-xs font-medium text-zinc-400">Font Family</span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {FONTS.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setStyle((s) => ({ ...s, font: f }))}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors cursor-pointer ${
                          style.font === f
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-[#252938] bg-[#171A24] text-zinc-300 hover:border-zinc-600'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Active Highlight Color */}
                <div>
                  <span className="block text-xs font-medium text-zinc-400">
                    Active Word Highlight Color
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {HIGHLIGHT_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setStyle((s) => ({ ...s, highlightColor: c.hex }))}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                          style.highlightColor === c.hex
                            ? 'border-amber-500 bg-[#1B1F2B] text-white'
                            : 'border-[#252938] bg-[#171A24] text-zinc-400 hover:text-white'
                        }`}
                      >
                        <span
                          className="h-3 w-3 rounded-sm border border-white/20"
                          style={{ backgroundColor: c.hex }}
                        />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Base Text Color */}
                <div>
                  <span className="block text-xs font-medium text-zinc-400">
                    Base Subtitle Color
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setStyle((s) => ({ ...s, textColor: c.hex }))}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                          style.textColor === c.hex
                            ? 'border-amber-500 bg-[#1B1F2B] text-white'
                            : 'border-[#252938] bg-[#171A24] text-zinc-400 hover:text-white'
                        }`}
                      >
                        <span
                          className="h-3 w-3 rounded-sm border border-white/20"
                          style={{ backgroundColor: c.hex }}
                        />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Size & Position */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="block text-xs font-medium text-zinc-400">Text Size</span>
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {(['sm', 'md', 'lg', 'xl'] as SubtitleSize[]).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setStyle((s) => ({ ...s, size: sz }))}
                          className={`rounded-lg border py-1.5 text-xs font-medium uppercase transition-colors cursor-pointer ${
                            style.size === sz
                              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                              : 'border-[#252938] bg-[#171A24] text-zinc-400 hover:text-white'
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="block text-xs font-medium text-zinc-400">Position</span>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {(['bottom', 'center', 'upper'] as SubtitlePosition[]).map((pos) => (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => setStyle((s) => ({ ...s, position: pos }))}
                          className={`rounded-lg border py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                            style.position === pos
                              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                              : 'border-[#252938] bg-[#171A24] text-zinc-400 hover:text-white'
                          }`}
                        >
                          {pos}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Words Per Line & Uppercase Toggle */}
                <div className="flex items-center justify-between gap-4 border-t border-[#1F2330] pt-4">
                  <div>
                    <span className="block text-xs font-medium text-zinc-300">
                      Words Per Line ({style.wordsPerLine})
                    </span>
                    <input
                      type="range"
                      min={2}
                      max={5}
                      step={1}
                      value={style.wordsPerLine}
                      onChange={(e) =>
                        setStyle((s) => ({ ...s, wordsPerLine: Number(e.target.value) }))
                      }
                      className="mt-1.5 w-36 accent-amber-500 cursor-pointer"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setStyle((s) => ({ ...s, uppercase: !s.uppercase }))}
                    className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                      style.uppercase
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-[#252938] bg-[#171A24] text-zinc-300'
                    }`}
                  >
                    ALL CAPS: {style.uppercase ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            )}

            {inspectorTab === 'subtitles' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-zinc-400">
                    Click any word to jump preview · Edit text or timing inline
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      updateActiveClip((clip) => {
                        const lastEnd =
                          clip.words[clip.words.length - 1]?.end ?? clip.startTime + 1;
                        const newStart = Math.min(clip.endTime - 0.5, lastEnd);
                        const newEnd = Math.min(clip.endTime, newStart + 0.8);
                        return {
                          ...clip,
                          words: [
                            ...clip.words,
                            {
                              id: `w-custom-${Date.now()}`,
                              word: 'NewWord',
                              start: Number(newStart.toFixed(2)),
                              end: Number(newEnd.toFixed(2)),
                            },
                          ],
                        };
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-[#2A2F40] bg-[#181B25] px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Word
                  </button>
                </div>

                {activeClip.words.length === 0 ? (
                  <div className="rounded-xl border border-[#252938] bg-[#0F1117] p-6 text-center text-xs text-zinc-400">
                    No subtitle words in this window yet. Click "Add Word" to start adding lyrics.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeClip.words.map((tok, wIdx) => (
                      <div
                        key={tok.id}
                        className="flex items-center gap-2 rounded-lg border border-[#222633] bg-[#0E1016] px-2.5 py-1.5"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSeekTrigger({ time: tok.start, seq: Date.now() })
                          }
                          title="Jump preview to this word"
                          className="shrink-0 font-mono text-[11px] text-amber-400 hover:underline tabular-nums cursor-pointer"
                        >
                          {(tok.start - activeClip.startTime).toFixed(1)}s
                        </button>

                        <input
                          type="text"
                          value={tok.word}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateActiveClip((clip) => ({
                              ...clip,
                              words: clip.words.map((w, i) =>
                                i === wIdx ? { ...w, word: val } : w
                              ),
                            }));
                          }}
                          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-white focus:outline-none"
                        />

                        <input
                          type="number"
                          step={0.1}
                          value={tok.start}
                          aria-label={`Start time for ${tok.word}`}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updateActiveClip((clip) => ({
                              ...clip,
                              words: clip.words.map((w, i) =>
                                i === wIdx ? { ...w, start: val } : w
                              ),
                            }));
                          }}
                          className="w-14 rounded border border-[#252938] bg-[#141720] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 tabular-nums focus:border-amber-500 focus:outline-none"
                        />
                        <input
                          type="number"
                          step={0.1}
                          value={tok.end}
                          aria-label={`End time for ${tok.word}`}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updateActiveClip((clip) => ({
                              ...clip,
                              words: clip.words.map((w, i) =>
                                i === wIdx ? { ...w, end: val } : w
                              ),
                            }));
                          }}
                          className="w-14 rounded border border-[#252938] bg-[#141720] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 tabular-nums focus:border-amber-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {inspectorTab === 'trim' && (
              <div className="space-y-6">
                {/* Clip Title Edit */}
                <div>
                  <label className="block text-xs font-medium text-zinc-400">
                    Clip Title (used for MP4 filename)
                  </label>
                  <input
                    type="text"
                    value={activeClip.title}
                    onChange={(e) =>
                      updateActiveClip((clip) => ({ ...clip, title: e.target.value }))
                    }
                    className="mt-2 h-10 w-full rounded-lg border border-[#262A38] bg-[#0A0B0F] px-3 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {/* Start & End Time Trim */}
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-400">Start & End Timestamps</span>
                    <span className="font-mono text-amber-400 tabular-nums">
                      Duration: {(activeClip.endTime - activeClip.startTime).toFixed(1)}s
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500">Start (sec)</label>
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, activeClip.endTime - 3)}
                        step={0.5}
                        value={activeClip.startTime}
                        onChange={(e) => {
                          const nextStart = Math.max(
                            0,
                            Math.min(activeClip.endTime - 3, Number(e.target.value) || 0)
                          );
                          updateActiveClip((clip) => ({
                            ...clip,
                            startTime: Number(nextStart.toFixed(1)),
                            duration: Number((clip.endTime - nextStart).toFixed(1)),
                          }));
                        }}
                        className="mt-1 h-10 w-full rounded-lg border border-[#262A38] bg-[#0A0B0F] px-3 font-mono text-sm text-white tabular-nums focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-zinc-500">End (sec)</label>
                      <input
                        type="number"
                        min={activeClip.startTime + 3}
                        max={job.duration}
                        step={0.5}
                        value={activeClip.endTime}
                        onChange={(e) => {
                          const nextEnd = Math.max(
                            activeClip.startTime + 3,
                            Math.min(job.duration, Number(e.target.value) || activeClip.startTime + 15)
                          );
                          updateActiveClip((clip) => ({
                            ...clip,
                            endTime: Number(nextEnd.toFixed(1)),
                            duration: Number((nextEnd - clip.startTime).toFixed(1)),
                          }));
                        }}
                        className="mt-1 h-10 w-full rounded-lg border border-[#262A38] bg-[#0A0B0F] px-3 font-mono text-sm text-white tabular-nums focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Quick Snap Durations */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {DURATION_OPTIONS.map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() =>
                          updateActiveClip((clip) => {
                            const nextEnd = Math.min(job.duration, clip.startTime + sec);
                            return {
                              ...clip,
                              endTime: Number(nextEnd.toFixed(1)),
                              duration: Number((nextEnd - clip.startTime).toFixed(1)),
                            };
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-[#252938] bg-[#171A24] px-2.5 py-1 font-mono text-xs text-zinc-300 hover:border-amber-500/60 hover:text-white tabular-nums cursor-pointer"
                      >
                        <Scissors className="h-3 w-3 text-amber-400" />
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* 9:16 Subject Auto-Crop Horizontal Focus */}
                <div className="border-t border-[#1F2330] pt-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">
                      9:16 Subject Horizontal Crop Focus
                    </span>
                    <button
                      type="button"
                      onClick={() => updateActiveClip((clip) => ({ ...clip, cropPan: 0 }))}
                      className="text-xs font-medium text-amber-400 hover:underline cursor-pointer"
                    >
                      Auto-Center
                    </button>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={activeClip.cropPan}
                    onChange={(e) =>
                      updateActiveClip((clip) => ({
                        ...clip,
                        cropPan: Number(e.target.value),
                      }))
                    }
                    className="mt-3 w-full accent-amber-500 cursor-pointer"
                  />
                  <div className="mt-1 flex justify-between font-mono text-[11px] text-zinc-500 tabular-nums">
                    <span>Left (-100%)</span>
                    <span>Center ({Math.round(activeClip.cropPan * 100)}%)</span>
                    <span>Right (+100%)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
