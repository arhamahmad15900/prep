import React, { useState } from 'react';
import { 
  FileText, 
  Award, 
  BookOpen, 
  CheckCircle2,
  Palette,
  Volume2,
  VolumeX,
  Compass,
  FileUp,
  Sparkles,
  Radio
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { ThemeSelectorModal } from './ThemeSelectorModal';
import { soundFx } from '../utils/audio';
import { motion } from 'motion/react';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  onOpenSyllabus?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onOpenSyllabus }) => {
  const { themeConfig, soundEnabled, setSoundEnabled } = useTheme();
  const [showThemeModal, setShowThemeModal] = useState<boolean>(false);

  return (
    <>
      <header className="no-print bg-slate-900/95 backdrop-blur-md text-white border-b border-slate-800/80 sticky top-0 z-40 shadow-xl transition-colors gpu-layer">
        {/* Top Gazette / Institutional Bar */}
        <div className="bg-slate-950/80 px-3 sm:px-4 py-1.5 border-b border-slate-800/80 text-xs text-slate-400">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] sm:text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-400 truncate max-w-[200px] sm:max-w-none">
                <Award className="w-3.5 h-3.5 shrink-0" />
                <span>NIELIT 'O' Level (IT)</span>
                <span className="hidden sm:inline">• Revision 5.1 (R5.1)</span>
              </span>
              <span className="text-slate-600 hidden md:inline">•</span>
              <span className="hidden md:inline text-slate-300 text-[11px]">
                Author: <span className="font-semibold text-cyan-300">Arham Ahmad Khan</span>
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 text-slate-400">
              {onOpenSyllabus && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenSyllabus();
                    soundFx.playClick();
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 transition-colors cursor-pointer py-1 px-1.5 rounded"
                >
                  <Compass className="w-3 h-3 shrink-0" />
                  <span className="whitespace-nowrap">Syllabus</span>
                </button>
              )}

              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                100 Qs / 90m &amp; 50 Qs / 45m
              </span>
            </div>
          </div>
        </div>

        {/* Main Navigation Bar */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-15 sm:h-16 gap-2 sm:gap-4">
            {/* Logo & Title */}
            <motion.div 
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none min-w-0"
              onClick={() => {
                setActiveTab('generator');
                soundFx.playClick();
              }}
            >
              <div className="relative">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl blur-xs opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-600/30 ring-1 ring-white/20 shrink-0">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-white drop-shadow" />
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <h1 className="font-display text-sm sm:text-lg font-black text-white tracking-tight truncate group-hover:text-cyan-200 transition-colors">
                    'O' Level Test Generator
                  </h1>
                  <span className="text-[9px] sm:text-[10px] font-mono font-bold tracking-wider px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 rounded-md shadow-xs">
                    R5.1
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 hidden lg:block truncate font-medium">
                  M1 (IT Tools) • M2 (Web Design) • M3 (Python) • M4 (IoT)
                </p>
              </div>
            </motion.div>

            {/* Navigation Tabs & Controls */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Desktop Navigation Tabs (Hidden on mobile, handled by mobile bottom nav) */}
              <nav className="hidden md:flex items-center gap-1 sm:gap-1.5 p-1 rounded-2xl bg-slate-950/70 border border-white/5 backdrop-blur-md">
                <button
                  id="tab-btn-host-join"
                  onClick={() => {
                    setActiveTab('host_join');
                    soundFx.playClick();
                  }}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 cursor-pointer relative z-10 ${
                    activeTab === 'host_join'
                      ? 'text-white'
                      : 'text-purple-300 hover:text-white'
                  }`}
                >
                  {activeTab === 'host_join' && (
                    <motion.div
                      layoutId="activeHeaderPill"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="absolute inset-0 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 rounded-xl shadow-md shadow-purple-600/40 ring-1 ring-white/20 -z-10"
                    />
                  )}
                  <Radio className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${activeTab === 'host_join' ? 'text-white' : 'text-purple-400'} animate-pulse`} />
                  <span className="font-display tracking-tight">Host &amp; Join</span>
                </button>

                <button
                  id="tab-btn-pdf-reasoning"
                  onClick={() => {
                    setActiveTab('pdf_reasoning');
                    soundFx.playClick();
                  }}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 cursor-pointer relative z-10 ${
                    activeTab === 'pdf_reasoning'
                      ? 'text-white'
                      : 'text-emerald-300 hover:text-white'
                  }`}
                >
                  {activeTab === 'pdf_reasoning' && (
                    <motion.div
                      layoutId="activeHeaderPill"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="absolute inset-0 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl shadow-md shadow-emerald-600/40 ring-1 ring-white/20 -z-10"
                    />
                  )}
                  <FileUp className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${activeTab === 'pdf_reasoning' ? 'text-white' : 'text-emerald-400'}`} />
                  <span className="font-display tracking-tight">PDF Notes</span>
                </button>

                <button
                  id="tab-btn-generator"
                  onClick={() => {
                    setActiveTab('generator');
                    soundFx.playClick();
                  }}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 cursor-pointer relative z-10 ${
                    activeTab === 'generator'
                      ? 'text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {activeTab === 'generator' && (
                    <motion.div
                      layoutId="activeHeaderPill"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 rounded-xl shadow-md shadow-blue-600/40 ring-1 ring-white/20 -z-10"
                    />
                  )}
                  <BookOpen className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${activeTab === 'generator' ? 'text-white' : 'text-blue-400'}`} />
                  <span className="font-display tracking-tight">Generator</span>
                </button>
              </nav>

              <div className="h-5 w-px bg-slate-800/80 mx-0.5 hidden md:block" />

              {/* Theme Selector Trigger */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => {
                  setShowThemeModal(true);
                  soundFx.playClick();
                }}
                className="min-h-[38px] min-w-[38px] sm:min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700/80 text-slate-300 hover:text-white transition-all text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                title="Change Theme & Aesthetics"
                aria-label="Change Theme"
              >
                <Palette className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="hidden lg:inline font-medium">{themeConfig.name}</span>
                <span className="text-xs hidden sm:inline">{themeConfig.icon}</span>
              </motion.button>

              {/* Quick Sound Mute Button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  soundFx.enabled = next;
                  if (next) soundFx.playClick();
                }}
                className="min-h-[38px] min-w-[38px] sm:min-h-[40px] p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700/80 text-slate-400 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                title={soundEnabled ? 'Mute Sound FX' : 'Enable Sound FX'}
                aria-label="Toggle Sound Effects"
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-500" />
                )}
              </motion.button>
            </div>
          </div>
        </div>
      </header>

      {/* Theme Selector Modal */}
      <ThemeSelectorModal
        isOpen={showThemeModal}
        onClose={() => setShowThemeModal(false)}
      />
    </>
  );
};
