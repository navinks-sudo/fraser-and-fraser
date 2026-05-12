import React from 'react';
import Sidebar from './Sidebar';

const MainLayout = ({ children }) => {
  return (
    <div className="flex min-h-screen bg-surface-canvas">
      <Sidebar />
      <main className="flex-1 overflow-y-auto h-screen">
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
