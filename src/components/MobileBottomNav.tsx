import React from 'react';
import { Compass, Search, Bookmark, MessageCircle } from 'lucide-react';
import { User, AppView } from '../types/textbase';
import { useLongPressDrag } from '../hooks/useLongPressDrag';

interface MobileBottomNavProps {
  currentView?: AppView | string;
  currentTab?: string;
  onNavigate?: (view: AppView) => void;
  onSelectTab?: (tab: string) => void;
  currentUser: User | null;
  /** On the reader page, App drives this from useHideHeaderOnScroll so the
      bottom bar hides on scroll down and returns on scroll up in lockstep
      with the navbar and the chapter toolbar (same hook, same thresholds).
      Elsewhere it stays visible: it is the primary mobile navigation. */
  visible?: boolean;
  /** Docked assistant: the chat bubble traded its corner for this bar. */
  chatDocked?: boolean;
  chatOpen?: boolean;
  onChatOpen?: () => void;
  onChatUndock?: () => void;
  /** Lifted while dragging the chat tab out of the bar, so the app can
      track the gesture alongside the reverse (bubble-to-bar) one. */
  onChatDragActiveChange?: (active: boolean, overTarget: boolean) => void;
  /** A chat drag (either direction) is in flight: the bar shows its
      drop-ready highlight, stronger while the pointer is over it. */
  chatDragActive?: boolean;
  chatDragOver?: boolean;
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
  visible = true,
  chatDocked = false,
  chatOpen = false,
  onChatOpen,
  onChatUndock,
  onChatDragActiveChange,
  chatDragActive = false,
  chatDragOver = false
}) => {
  const activeView = (currentView || currentTab || 'browse') as AppView;
  const navigate = (view: AppView) => {
    if (onNavigate) onNavigate(view);
    if (onSelectTab) onSelectTab(view);
  };

  // Long-press the docked chat tab and drag it into the page to send the
  // assistant back to its floating corner; dropped back onto the bar it
  // stays docked. The tab itself never moves - a ghost bubble follows the
  // pointer instead.
  const chatDrag = useLongPressDrag({
    targetId: 'mobile-bottom-nav',
    onDropOutside: () => onChatUndock?.(),
    onDropTarget: () => {},
    onDragActiveChange: onChatDragActiveChange,
    enabled: chatDocked,
  });

  return (
    <div id="mobile-bottom-nav" className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[linear-gradient(90deg,rgba(2,64,99,0.96)_0%,rgba(60,168,63,0.92)_22%,rgba(4,74,111,0.96)_100%)] backdrop-blur-lg border-t border-emerald-400/25 px-4 py-2 flex items-center justify-around shadow-2xl transition-transform duration-300 ${visible ? 'translate-y-0' : 'translate-y-full'} ${chatDragActive ? (chatDragOver ? 'ring-2 ring-inset ring-amber-300/90' : 'ring-2 ring-inset ring-amber-400/50') : ''}`}>
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

      {chatDocked && (
        <button
          id="mobile-nav-chat"
          onClick={() => { if (chatDrag.justDragged()) return; onChatOpen?.(); }}
          onPointerDown={chatDrag.onPointerDown}
          onContextMenu={event => event.preventDefault()}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-all cursor-pointer active:scale-95 active:brightness-90 touch-none select-none ${chatDrag.dragging ? 'opacity-40' : ''} ${
            chatOpen ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES
          }`}
        >
          <MessageCircle className={`w-5 h-5 mb-0.5 ${chatOpen ? 'tab-pop' : ''}`} />
          <span className={`text-[10px] uppercase tracking-wider ${chatOpen ? 'font-extrabold' : 'font-bold'}`}>Chat</span>
        </button>
      )}

      {/* While dragging the docked tab out, a ghost bubble follows the
          pointer; the tab itself stays put (dimmed) until the drop lands. */}
      {chatDrag.dragging && chatDrag.origin && chatDrag.offset && (
        <div
          className="fixed z-[80] w-14 h-14 rounded-full grid place-items-center text-white border border-white/30 shadow-xl pointer-events-none"
          style={{
            left: chatDrag.origin.x + chatDrag.offset.dx - 28,
            top: chatDrag.origin.y + chatDrag.offset.dy - 28,
            background: 'linear-gradient(135deg, #34d399, #075985)'
          }}
        >
          <MessageCircle className="w-6 h-6" />
        </div>
      )}
    </div>
  );
};
