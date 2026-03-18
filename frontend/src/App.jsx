import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Shield, LayoutDashboard, Mic } from 'lucide-react';
import Recorder from './components/Recorder';
import Dashboard from './components/Dashboard';

function Navigation() {
  const location = useLocation();
  
  return (
    <nav className="nav-links">
      <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
        <Mic size={18} style={{ verticalAlign: 'middle', marginRight: '4px' }}/> Record
      </Link>
      <Link to="/dashboard" className={location.pathname === '/dashboard' ? 'active' : ''}>
        <LayoutDashboard size={18} style={{ verticalAlign: 'middle', marginRight: '4px' }}/> History & Insights
      </Link>
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <header className="header">
          <div className="logo">
            <Shield size={28} color="#6366f1" />
            FinanScape
          </div>
          <Navigation />
        </header>
        
        <main>
          <Routes>
            <Route path="/" element={<Recorder />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/insights/:id" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
