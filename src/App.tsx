import { useState } from 'react';
import { ClipStudio } from './components/ClipStudio.tsx';
import { HomeLanding } from './components/HomeLanding.tsx';
import { Navbar } from './components/Navbar.tsx';
import type { MomentCategory, VideoJobInfo } from './types/clip.ts';
import { parseApiJson } from './utils/api.ts';

export default function App() {
  const [view, setView] = useState<'home' | 'studio'>('home');
  const [job, setJob] = useState<VideoJobInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAnalyzeUrl = async (
    url: string,
    category: MomentCategory,
    targetDuration: number
  ) => {
    setIsLoading(true);
    setError(null);
    setLoadingStep(
      'Fetching YouTube video, extracting audio & captions, and detecting viral moments...'
    );

    try {
      const res = await fetch('/api/video/analyze-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, category, targetDuration }),
      });

      const data = await parseApiJson<VideoJobInfo & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze YouTube link.');
      }

      setJob(data);
      setView('studio');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not process this YouTube video. Check the URL or upload a local video file.'
      );
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const uploadVideoFile = async (
    file: File,
    category: MomentCategory,
    targetDuration: number,
    existingJobId?: string
  ): Promise<VideoJobInfo> => {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('category', category);
    formData.append('targetDuration', String(targetDuration));
    if (existingJobId) {
      formData.append('jobId', existingJobId);
    }

    const res = await fetch('/api/video/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await parseApiJson<VideoJobInfo & { error?: string }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'Video upload failed.');
    }
    return data;
  };

  const handleHomeUpload = async (
    file: File,
    category: MomentCategory,
    targetDuration: number
  ) => {
    setIsLoading(true);
    setError(null);
    setLoadingStep(
      `Uploading "${file.name}", transcribing spoken audio, and detecting ${category.toLowerCase()}...`
    );

    try {
      const uploadedJob = await uploadVideoFile(file, category, targetDuration);
      setJob(uploadedJob);
      setView('studio');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to process uploaded video file.'
      );
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleAttachUploadInStudio = async (
    file: File,
    existingJobId: string,
    category: MomentCategory,
    targetDuration: number
  ) => {
    const updatedJob = await uploadVideoFile(file, category, targetDuration, existingJobId);
    setJob(updatedJob);
  };

  return (
    <div className="min-h-screen bg-[#0A0B0F] text-[#F4F5F7]">
      <Navbar
        hasActiveJob={job !== null}
        view={view}
        onNavigateHome={() => setView('home')}
        onOpenStudio={() => {
          if (job) setView('studio');
        }}
      />

      {view === 'studio' && job ? (
        <ClipStudio
          job={job}
          onBackHome={() => setView('home')}
          onJobUpdated={(updated) => setJob(updated)}
          onAttachUpload={handleAttachUploadInStudio}
        />
      ) : (
        <HomeLanding
          isLoading={isLoading}
          loadingStep={loadingStep}
          error={error}
          onAnalyzeUrl={handleAnalyzeUrl}
          onUploadFile={handleHomeUpload}
        />
      )}
    </div>
  );
}
