import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import BatchDetail from './pages/BatchDetail';
import VisionMax from './pages/VisionMax';
import TextIQ from './pages/TextIQ';
import IndexGenius from './pages/IndexGenius';
import GedcomXView from './pages/GedcomXView';
import TreeViewer from './pages/TreeViewer';
import MainLayout from './components/Layout/MainLayout';
import useAuthStore from './store/authStore';

const queryClient = new QueryClient();

const PrivateRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          <Route path="/dashboard" element={
            <PrivateRoute>
              <MainLayout>
                <Dashboard />
              </MainLayout>
            </PrivateRoute>
          } />
          
          <Route path="/projects/:project_id" element={
            <PrivateRoute>
              <MainLayout>
                <ProjectDetail />
              </MainLayout>
            </PrivateRoute>
          } />
          
          <Route path="/projects/:project_id/batches/:batch_id" element={
            <PrivateRoute>
              <MainLayout>
                <BatchDetail />
              </MainLayout>
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/visionmax" element={
            <PrivateRoute>
              <VisionMax />
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/textiq" element={
            <PrivateRoute>
              <TextIQ />
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/indexgenius" element={
            <PrivateRoute>
              <IndexGenius />
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/gedcomx" element={
            <PrivateRoute>
              <GedcomXView />
            </PrivateRoute>
          } />

          <Route path="/projects/:project_id/batches/:batch_id/tree" element={
            <PrivateRoute>
              <TreeViewer />
            </PrivateRoute>
          } />

          <Route path="/" element={<Landing />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
