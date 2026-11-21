import React from 'react';

interface NavbarProps {
  hasActiveJob: boolean;
  view: 'home' | 'studio';
  onNavigateHome: () => void;
  onOpenStudio: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  hasActiveJob,
  view,
  onNavigateHome,
  onOpenStudio,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-[#222633] bg-[#0A0B0F]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={onNavigateHome}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-md"
        >
          ClipKaro AI
        </button>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
          <a
            href="#features"
            onClick={() => {
              if (view !== 'home') onNavigateHome();
            }}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Features
          </a>
          <a
            href="#lyrical-subtitles"
            onClick={() => {
              if (view !== 'home') onNavigateHome();
            }}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Subtitles
          </a>
          <a
            href="#vertical-format"
            onClick={() => {
              if (view !== 'home') onNavigateHome();
            }}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            9:16 Crop
          </a>
          <a
            href="#export-workflow"
            onClick={() => {
              if (view !== 'home') onNavigateHome();
            }}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            1080p Export
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          {hasActiveJob ? (
            <button
              type="button"
              onClick={view === 'studio' ? onNavigateHome : onOpenStudio}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              {view === 'studio' ? 'New Video' : 'Open Studio'}
            </button>
          ) : (
            <a
              href="#clip-input"
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              Start Clipping
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
