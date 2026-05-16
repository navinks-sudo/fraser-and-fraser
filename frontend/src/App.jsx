import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import BatchDetail from './pages/BatchDetail';
import Workspace from './pages/Workspace';
import VisionMax from './pages/VisionMax';
import TextIQ from './pages/TextIQ';
import IndexGenius from './pages/IndexGenius';
import GedcomXView from './pages/GedcomXView';
import TreeViewer from './pages/TreeViewer';
import MainLayout from './components/Layout/MainLayout';
import ErrorBoundary from './components/ErrorBoundary';
import useAuthStore from './store/authStore';

const queryClient = new QueryClient();

const PrivateRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" />;
};

// Wrap every route element so a render crash on one page doesn't blank the
// whole app. The boundary shows the error message + stack inline.
const Guarded = ({ children }) => <ErrorBoundary>{children}</ErrorBoundary>;

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/login"    element={<Guarded><Login /></Guarded>} />
          <Route path="/register" element={<Guarded><Register /></Guarded>} />

          <Route path="/dashboard" element={
            <PrivateRoute>
              <MainLayout>
                <Guarded><Dashboard /></Guarded>
              </MainLayout>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id" element={
            <PrivateRoute>
              <MainLayout>
                <Guarded><ProjectDetail /></Guarded>
              </MainLayout>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id" element={
            <PrivateRoute>
              <Guarded><Workspace /></Guarded>
            </PrivateRoute>
          } />
          <Route path="/projects/:project_id/batches/:batch_id/classic" element={
            <PrivateRoute>
              <MainLayout>
                <Guarded><BatchDetail /></Guarded>
              </MainLayout>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/visionmax" element={
            <PrivateRoute>
              <Guarded><VisionMax /></Guarded>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/textiq" element={
            <PrivateRoute>
              <Guarded><TextIQ /></Guarded>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/indexgenius" element={
            <PrivateRoute>
              <Guarded><IndexGenius /></Guarded>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/gedcomx" element={
            <PrivateRoute>
              <Guarded><GedcomXView /></Guarded>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/tree" element={
            <PrivateRoute>
              <Guarded><TreeViewer /></Guarded>
            </PrivateRoute>
          } />

          <Route path="/" element={<Guarded><Landing /></Guarded>} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
