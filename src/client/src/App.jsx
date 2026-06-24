import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import ActiveBidding from './pages/ActiveBidding';
import Submit from './pages/Submit';
import TaskList from './pages/TaskList';
import WonItems from './pages/WonItems';
import PurchasePage from './pages/PurchasePage';
import Statistics from './pages/Statistics';
import { installUserActivityListeners } from './utils/activity';
import ManualVerificationAlert from './components/ManualVerificationAlert';
import UserNav from './components/UserNav';
import UserFooter from './components/UserFooter';
import { pageStyle } from './styles';

installUserActivityListeners();

function ProtectedLayout() {
  const token = localStorage.getItem('token');
  const location = useLocation();
  const isPurchasePage = /^\/won\/[^/]+\/purchase-page$/.test(location.pathname);
  return token ? (
    <div style={isPurchasePage ? { minHeight: '100vh', background: '#fff' } : pageStyle}>
      {!isPurchasePage && <ManualVerificationAlert />}
      {!isPurchasePage && <UserNav />}
      <Outlet />
      {!isPurchasePage && <UserFooter />}
    </div>
  ) : <Navigate to="/login" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/submit" element={<Submit />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/bidding" element={<ActiveBidding />} />
          <Route path="/won" element={<WonItems />} />
          <Route path="/won/:id/purchase-page" element={<PurchasePage />} />
          <Route path="/stats" element={<Statistics />} />
        </Route>
        <Route path="*" element={<Navigate to="/submit" />} />
      </Routes>
    </BrowserRouter>
  );
}
