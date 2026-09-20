import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ApiError } from './api/client';
import { Layout } from './components/Layout';
import { I18nProvider } from './i18n';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CalendarPage } from './pages/CalendarPage';
import { ClientPage } from './pages/ClientPage';
import { ClientsPage } from './pages/ClientsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DentistPage } from './pages/DentistPage';
import { DentistsPage } from './pages/DentistsPage';
import { HelpPage } from './pages/HelpPage';
import { JournalPage } from './pages/journal/JournalPage';
import { OfficesPage } from './pages/OfficesPage';
import { OperatorPage } from './pages/OperatorPage';
import { ServicesPage } from './pages/ServicesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { WebsitePage } from './pages/WebsitePage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Ошибки 4xx повтором не лечатся
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    { path: '/register', element: <RegisterPage /> },
    { path: '/operator', element: <OperatorPage /> },
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <Navigate to="/journal" replace /> },
        { path: 'journal', element: <JournalPage /> },
        { path: 'clients', element: <ClientsPage /> },
        { path: 'clients/:id', element: <ClientPage /> },
        { path: 'dashboard', element: <DashboardPage /> },
        { path: 'calendar', element: <CalendarPage /> },
        { path: 'dentists', element: <DentistsPage /> },
        { path: 'dentists/:id', element: <DentistPage /> },
        { path: 'services', element: <ServicesPage /> },
        { path: 'offices', element: <OfficesPage /> },
        { path: 'website', element: <WebsitePage /> },
        { path: 'staff', element: <StaffPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'help', element: <HelpPage /> },
        { path: '*', element: <Navigate to="/journal" replace /> },
      ],
    },
  ],
  { basename: '/admin' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
