import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { companyFromPath } from './lib/api';
import { AuthProvider } from './lib/auth';
import { TourProvider } from './lib/tour';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './lib/theme';
import { NotificationsProvider } from './lib/notifications';
import './styles.css';

// Agency staff work inside a client company under /c/<slug>/…: the whole app runs with that base,
// so every in-app link stays relative to the company. Switching company is a full navigation.
const slug = companyFromPath();
const basename = slug ? `/c/${slug}` : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <ThemeProvider>
        <AuthProvider>
          <NotificationsProvider>
            <ToastProvider>
              <TourProvider>
                <App />
              </TourProvider>
            </ToastProvider>
          </NotificationsProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
