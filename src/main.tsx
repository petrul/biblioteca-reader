import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {relayConsoleToServer} from './services/logRelay.ts';
import {installReleasePointerFocus} from './services/releasePointerFocus.ts';
import {installReadLimitWatcher} from './services/readLimit.ts';
import {ensureGuestName} from './services/guestName.ts';
import {ReadLimitModal} from './components/ReadLimitModal.tsx';
import './fonts.ts';
import './index.css';

// The reader's own logging now also shows in the `rake run`
// terminal (see services/logRelay.ts).
relayConsoleToServer();
// Clicked buttons do not keep the focus (and its ring) - see releasePointerFocus.ts.
installReleasePointerFocus();
// Hourly reading-limit notices from the server become a blocking card - see services/readLimit.ts.
installReadLimitWatcher();
// Names this browser in the services' logs while not signed in - see services/guestName.ts.
void ensureGuestName();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ReadLimitModal />
  </StrictMode>,
);
