import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import DataEntry from './pages/DataEntry';
import Charts from './pages/Charts';
import Fire from './pages/Fire';
import Funds from './pages/Funds';
import Income from './pages/Income';
import Expenses from './pages/Expenses';
import Import from './pages/Import';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/data-entry" element={<DataEntry />} />
          <Route path="/charts" element={<Charts />} />
          <Route path="/fire" element={<Fire />} />
          <Route path="/funds" element={<Funds />} />
          <Route path="/income" element={<Income />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/import" element={<Import />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
