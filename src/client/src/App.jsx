import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ActiveBidding from './pages/ActiveBidding';
import Submit from './pages/Submit';
import TaskList from './pages/TaskList';
import WonItems from './pages/WonItems';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/submit" element={<ProtectedRoute><Submit /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><TaskList /></ProtectedRoute>} />
        <Route path="/bidding" element={<ProtectedRoute><ActiveBidding /></ProtectedRoute>} />
        <Route path="/won" element={<ProtectedRoute><WonItems /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/submit" />} />
      </Routes>
    </BrowserRouter>
  );
}
