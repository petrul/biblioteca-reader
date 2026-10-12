import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {relayConsoleToServer} from './services/logRelay.ts';
import {installReleasePointerFocus} from './services/releasePointerFocus.ts';
import './index.css';

// The reader's own logging now also shows in the `rake run`
// terminal (see services/logRelay.ts).
relayConsoleToServer();
// Clicked buttons do not keep the focus (and its ring) - see releasePointerFocus.ts.
installReleasePointerFocus();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
