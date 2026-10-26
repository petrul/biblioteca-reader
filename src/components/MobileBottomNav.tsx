import React from 'react';
import { Compass, Search, Bookmark, Menu } from 'lucide-react';
import { User, AppView } from '../types/textbase';

interface MobileBottomNavProps {
  currentView?: AppView | string;
  currentTab?: string;
  onNavigate?: (view: AppView) => void;
  onSelectTab?: (tab: string) => void;
  currentUser: User | null;
  isAdmin?: boolean;
  onOpenAdminSidebar?: () => void;
  /** On the reader page, App drives this from useHideHeaderOnScroll so the
      bottom bar hides on scroll down and returns on scroll up in lockstep
      with the navbar and the chapter toolbar (same hook, same thresholds).
      Elsewhere it stays visible: it is the primary mobile navigation. */
  visible?: boolean;
}

// The selected tab's own highlight: amber tint + ring + glow (a ring, not
// a border, so the active state never shifts the tab's layout), an
// extra-bold label, and a one-shot icon pop (.tab-pop in index.css).
const ACTIVE_TAB_CLASSES = 'text-[#f59e0b] bg-amber-500/10 ring-1 ring-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.25)]';
const INACTIVE_TAB_CLASSES = 'text-emerald-100/60 hover:text-white';

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentView,
  currentTab,
  onNavigate,
  onSelectTab,
  currentUser,
  isAdmin = false,
  onOpenAdminSidebar,
  visible = true
}) => {
  const activeView = (currentView || currentTab || 'browse') as AppView;
  const navigate = (view: AppView) => {
    if (onNavigate) onNavigate(view);
    if (onSelectTab) onSelectTab(view);
  };

  return (
    <div id="mobile-bottom-nav" className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[linear-gradient(90deg,rgba(2,64,99,0.96)_0%,rgba(60,168,63,0.92)_22%,rgba(4,74,111,0.96)_100%)] backdrop-blur-lg border-t border-emerald-400/25 px-4 py-2 flex items-center justify-around shadow-2xl transition-transform duration-300 ${visible ? 'translate-y-0' : 'translate-y-full'}`}>
      <button
        id="mobile-nav-browse"
        onClick={() => navigate('browse')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-all cursor-pointer active:scale-95 active:brightness-90 ${
          activeView === 'browse' || activeView === 'work' || activeView === 'author'
            ? ACTIVE_TAB_CLASSES
            : INACTIVE_TAB_CLASSES
        }`}
      >
        <Compass className={`w-5 h-5 mb-0.5 ${activeView === 'browse' || activeView === 'work' || activeView === 'author' ? 'tab-pop' : ''}`} />
        <span className={`text-[10px] uppercase tracking-wider ${activeView === 'browse' || activeView === 'work' || activeView === 'author' ? 'font-extrabold' : 'font-bold'}`}>Catalog</span>
      </button>

      <button
        id="mobile-nav-search"
        onClick={() => navigate('search')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-all cursor-pointer active:scale-95 active:brightness-90 ${
          activeView === 'search' ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES
        }`}
      >
        <Search className={`w-5 h-5 mb-0.5 ${activeView === 'search' ? 'tab-pop' : ''}`} />
        <span className={`text-[10px] uppercase tracking-wider ${activeView === 'search' ? 'font-extrabold' : 'font-bold'}`}>Search</span>
      </button>

      <button
        id="mobile-nav-collections"
        onClick={() => navigate('collections')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-all cursor-pointer active:scale-95 active:brightness-90 ${
          activeView === 'collections' ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES
        }`}
      >
        <Bookmark className={`w-5 h-5 mb-0.5 ${activeView === 'collections' ? 'tab-pop' : ''}`} />
        <span className={`text-[10px] uppercase tracking-wider ${activeView === 'collections' ? 'font-extrabold' : 'font-bold'}`}>Library</span>
      </button>

      {isAdmin && onOpenAdminSidebar && (
        <button
          id="mobile-nav-admin-drawer"
          onClick={onOpenAdminSidebar}
          className="flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-all text-emerald-100/60 hover:text-amber-300 cursor-pointer active:scale-95 active:brightness-90"
        >
          <Menu className="w-5 h-5 mb-0.5 text-[#f59e0b]" />
          <span className="text-[10px] uppercase tracking-wider font-bold">Admin</span>
        </button>
      )}
    </div>
  );
};
