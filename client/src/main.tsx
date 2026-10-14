import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { TourProvider } from './lib/tour';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './lib/theme';
import { NotificationsProvider } from './lib/notifications';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
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
