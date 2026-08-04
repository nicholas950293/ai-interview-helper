import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import { AppRoutes } from './app/routes';

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 掛載點');
}

createRoot(container).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>
);
