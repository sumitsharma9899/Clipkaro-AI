export type MomentCategory =
  | 'All Viral Moments'
  | 'Funny Moments'
  | 'Adventure Moments'
  | 'Emotional Moments'
  | 'Action Moments'
  | 'Motivational Moments';

export type SubtitlePreset =
  | 'lyrical-pop'
  | 'neon-karaoke'
  | 'classic-reel'
  | 'desi-bold';

export type SubtitleFont =
  | 'Bricolage Grotesque'
  | 'Plus Jakarta Sans'
  | 'Oswald'
  | 'JetBrains Mono';

export type SubtitleSize = 'sm' | 'md' | 'lg' | 'xl';

export type SubtitlePosition = 'bottom' | 'center' | 'upper';

export interface WordToken {
  id: string;
  word: string;
  /** Seconds relative to the start of the source video */
  start: number;
  /** Seconds relative to the start of the source video */
  end: number;
}

export interface ClipMoment {
  id: string;
  title: string;
  category: Exclude<MomentCategory, 'All Viral Moments'>;
  startTime: number;
  endTime: number;
  duration: number;
  hookReason: string;
  detectedLanguage: string;
  /** Word-by-word tokens with timestamps relative to the source video */
  words: WordToken[];
  /** Horizontal subject crop offset from -1 (left) to +1 (right), 0 = center */
  cropPan: number;
}

export interface SubtitleStyle {
  preset: SubtitlePreset;
  font: SubtitleFont;
  size: SubtitleSize;
  position: SubtitlePosition;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  uppercase: boolean;
  wordsPerLine: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface VideoJobInfo {
  jobId: string;
  sourceType: 'youtube' | 'upload';
  youtubeUrl?: string;
  videoId?: string;
  title: string;
  channel: string;
  thumbnailUrl?: string;
  duration: number;
  width: number;
  height: number;
  videoReady: boolean;
  streamBlockedReason?: string;
  detectedLanguage: string;
  transcriptSegments: TranscriptSegment[];
  moments: ClipMoment[];
}
